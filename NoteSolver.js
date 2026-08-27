"use strict";

(function() {
    const MainApplication = org.openstreetmap.josm.gui.MainApplication;

    // --- Importacoes Java ---
    const JDialog              = Java.type("javax.swing.JDialog");
    const JPanel               = Java.type("javax.swing.JPanel");
    const JButton              = Java.type("javax.swing.JButton");
    const JLabel               = Java.type("javax.swing.JLabel");
    const BoxLayout            = Java.type("javax.swing.BoxLayout");
    const JScrollPane          = Java.type("javax.swing.JScrollPane");
    const BorderLayout         = Java.type("java.awt.BorderLayout");
    const Dimension            = Java.type("java.awt.Dimension");
    const Notification         = Java.type("org.openstreetmap.josm.gui.Notification");
    const UIManager            = Java.type("javax.swing.UIManager");
    const Color                = Java.type("java.awt.Color");
    const BasicStroke          = Java.type("java.awt.BasicStroke");
    const AlphaComposite       = Java.type("java.awt.AlphaComposite");
    const Path2D               = Java.type("java.awt.geom.Path2D");
    const Path2DFloat          = Java.type("java.awt.geom.Path2D$Float");
    const SwingUtilities       = Java.type("javax.swing.SwingUtilities");
    const WindowAdapter        = Java.type("java.awt.event.WindowAdapter");
    const JOptionPane          = Java.type("javax.swing.JOptionPane");
    const BorderFactory        = Java.type("javax.swing.BorderFactory");
    const GridBagLayout        = Java.type("java.awt.GridBagLayout");
    const GridBagConstraints   = Java.type("java.awt.GridBagConstraints");
    const Insets               = Java.type("java.awt.Insets");
    const Font                 = Java.type("java.awt.Font");
    const Integer              = Java.type("java.lang.Integer");
    const JCheckBox            = Java.type("javax.swing.JCheckBox");
    const ChangesetCache       = Java.type("org.openstreetmap.josm.data.osm.ChangesetCache");
    const ChangesetCacheListener = Java.type("org.openstreetmap.josm.data.osm.ChangesetCacheListener");
    
    // Classes utilitárias thread-safe do Java
    const ConcurrentHashMap    = Java.type("java.util.concurrent.ConcurrentHashMap");
    const AtomicBoolean        = Java.type("java.util.concurrent.atomic.AtomicBoolean");

    const MapViewPaintable     = org.openstreetmap.josm.gui.layer.MapViewPaintable;
    const NoteLayer            = org.openstreetmap.josm.gui.layer.NoteLayer;
    const LayerChangeListener  = org.openstreetmap.josm.gui.layer.LayerManager.LayerChangeListener;

    // --- Variáveis de Estado Globais ---
    let dialog = null;
    let windowAdapter = null;
    let isCleanedUp = false;
    let rememberedNotes = []; 
    let currentPainter = null;
    let notesJList = null;
    let rendererOriginal = null;
    let chkInject = null;
    let updateUI = null;
    let listPanel = null;
    let listBorder = null;
    const COR_DESTAQUE = new Color(114, 86, 39); // Laranja

    // Dicionário thread-safe do Java para isolar o ChangesetCache
    const activeUploadChangesets = new ConcurrentHashMap();
    const triggerProcessamento = new AtomicBoolean(false);
    let pendingChangesetId = null;

    // --- Lógica de Destaque no Painel Lateral ---
    const encontrarNotesJList = function() {
        try {
            const map = MainApplication.getMap();
            if (!map) return null;
            const buscarRecursivo = function(comp, classe) {
                if (!comp) return null;
                if (comp.getClass().getSimpleName() === classe) return comp;
                if (comp.getComponents) {
                    let kids = comp.getComponents();
                    for (let i = 0; i < kids.length; i++) {
                        let r = buscarRecursivo(kids[i], classe);
                        if (r) return r;
                    }
                }
                return null;
            };
            const notesDialog = buscarRecursivo(map, "NotesDialog");
            return notesDialog ? buscarRecursivo(notesDialog, "JList") : null;
        } catch(e) { return null; }
    };

    // Set Java thread-safe para o renderer — evita acesso à closure JS pela EDT
    const capturedNoteIds = new (Java.type("java.util.concurrent.CopyOnWriteArraySet"))();

    const syncCapturedIds = function() {
        capturedNoteIds.clear();
        rememberedNotes.forEach(function(item) {
            capturedNoteIds.add(String(item.note.getId()));
        });
    };

    const instalarRendererDestaque = function() {
        notesJList = encontrarNotesJList();
        if (!notesJList) return;
        rendererOriginal = notesJList.getCellRenderer();
        const DefaultListCellRenderer = Java.extend(Java.type("javax.swing.DefaultListCellRenderer"));
        const customRenderer = new DefaultListCellRenderer({
            getListCellRendererComponent: function(list, value, index, isSelected, cellHasFocus) {
                const comp = rendererOriginal.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus);
                // Acessa apenas o Set Java thread-safe — sem tocar em closures JS
                if (!isSelected && value !== null) {
                    if (capturedNoteIds.contains(String(value.getId()))) {
                        comp.setBackground(COR_DESTAQUE);
                        comp.setOpaque(true);
                    }
                }
                return comp;
            }
        });
        notesJList.setCellRenderer(customRenderer);
    };

    // Captura Segura de Changeset via ChangesetCache
    const changesetCacheListener = new (Java.extend(ChangesetCacheListener, {
        changesetCacheUpdated: function(event) {
            try {
				// 1. Rastreia guardando a String do ID
                const added = event.getAddedChangesets().iterator();
                while (added.hasNext()) {
                    let cs = added.next();
                    if (cs.isOpen()) {
                        activeUploadChangesets.put(String(cs.getId()), true);
                    }
                }

                // 2. Verifica se a String do ID existe no objeto e limpa
				const updated = event.getUpdatedChangesets().iterator();
                while (updated.hasNext()) {
                    let cs = updated.next();
                    let csIdStr = String(cs.getId());
                    if (!cs.isOpen() && activeUploadChangesets.containsKey(csIdStr)) {
                        activeUploadChangesets.remove(csIdStr);
                        pendingChangesetId = csIdStr;
                        triggerProcessamento.set(true);
                    }
                }
            } catch (e) {
                java.lang.System.err.println("Erro no ChangesetCacheListener: " + e);
            }
        }
    }))();

    // Timer leve do Swing para verificar com segurança a conclusão do upload
    const timerVerificacao = new javax.swing.Timer(500, new (Java.extend(Java.type("java.awt.event.ActionListener"), {
        actionPerformed: function(e) {
            // Processa fechamento de changeset
            if (triggerProcessamento.getAndSet(false)) {
                if (pendingChangesetId && rememberedNotes.length > 0) {
                    let idToProcess = pendingChangesetId;
                    pendingChangesetId = null;
                    processarFechamentoNotas(idToProcess);
                }
            }
            // Processa remoção de camada de notas
            if (noteLayerRemoved.getAndSet(false)) {
                rememberedNotes = [];
                syncCapturedIds();
                if (updateUI) updateUI();
                refreshMap(); syncTags();
                if (notesJList) notesJList.repaint();
            }
            // Processa adição de camada de notas
            if (noteLayerAdded.getAndSet(false) && !notesJList) {
                instalarRendererDestaque();
            }
        }
    })));
    timerVerificacao.start();

    const processarFechamentoNotas = function(id) {
            const noteLayer = MainApplication.getLayerManager().getNoteLayer();
            if (!noteLayer || rememberedNotes.length === 0) return;
            const nd = noteLayer.getNoteData();

            const notaAtualPorId = {};
            const notasAtuais = nd.getNotes();
            const itN = notasAtuais.iterator();
            
            while (itN.hasNext()) {
                const n = itN.next();
                notaAtualPorId[String(n.getId())] = n;
            }

            rememberedNotes.forEach(function(item) {
                try {
                    const notaIdStr = String(item.note.getId());
                    const notaAtual = notaAtualPorId[notaIdStr] || item.note;
                    
                    if (notaAtual.getState().toString() !== "CLOSED") {
                        let finalComment = (item.comment ? item.comment + "\n" : "") + "Resolvido com https://www.openstreetmap.org/changeset/" + id;
                        nd.closeNote(notaAtual, finalComment);
                    }
                } catch (err) { java.lang.System.err.println("Erro ao fechar nota: " + item.note.getId() + " - " + err); }
            });
            
            rememberedNotes = [];
            syncCapturedIds(); if (updateUI) updateUI(); 
            refreshMap(); 
            syncTags();
            if (notesJList) notesJList.repaint();

            try {
                const UploadNotesAction = Java.type("org.openstreetmap.josm.actions.UploadNotesAction");
                new UploadNotesAction().actionPerformed(null);
            } catch (err) { java.lang.System.err.println("Erro Upload: " + err); }
    };

    // --- Lógica de Destaque das Notas no Mapa ---
    const createPainter = function() {
        const PaintClass = Java.extend(MapViewPaintable, {
            paint: function(g, mv, bbox) {
                try {
                    if (rememberedNotes.length === 0) return;
                    g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.75));
                    g.setStroke(new BasicStroke(2.0));
                    g.setColor(Color.ORANGE);
                    rememberedNotes.forEach(function(item) {
                        const p = mv.getPoint(item.note.getLatLon());
                        const drop = new Path2DFloat();
                        drop.moveTo(p.x, p.y);
                        drop.curveTo(p.x - 5, p.y - 5, p.x - 7, p.y - 15, p.x, p.y - 15);
                        drop.curveTo(p.x + 7, p.y - 15, p.x + 5, p.y - 5, p.x, p.y);
                        drop.closePath();
                        g.fill(drop); g.draw(drop);
                    });
                } catch(e) {}
            }
        });
        return new PaintClass();
    };

    const refreshMap = function() {
        if (!MainApplication.getMap()) return;
        const mv = MainApplication.getMap().mapView;
        if (currentPainter) { try { mv.removeTemporaryLayer(currentPainter); } catch(e) {} }
        currentPainter = createPainter();
        mv.addTemporaryLayer(currentPainter);
        mv.repaint();
    };

    const syncTags = function() {
        const ds = MainApplication.getLayerManager().getEditDataSet();
        if (!ds) return;
        if (rememberedNotes.length > 0) {
            const ids = rememberedNotes.map(function(n) { return n.note.getId().toString(); }).join(';');
            ds.addChangeSetTag("closed:note", ids);
            if (chkInject && chkInject.isSelected()) {
                ds.addChangeSetTag("comment", "Resolvendo notas, " + ids.replace(/;/g, ", "));
            }
        } else {
            ds.addChangeSetTag("closed:note", null);
            if (chkInject && chkInject.isSelected()) {
                ds.addChangeSetTag("comment", null);
            }
        }
    };

    // Flags thread-safe para eventos de camada — consumidas pelo timerVerificacao
    const noteLayerRemoved = new AtomicBoolean(false);
    const noteLayerAdded   = new AtomicBoolean(false);

    const layerHandler = new (Java.extend(LayerChangeListener, {
        layerRemoving: function(e) {
            // Só código Java puro — sem chamar JS
            if (e.getRemovedLayer() instanceof NoteLayer) noteLayerRemoved.set(true);
        },
        layerAdded: function(e) {
            if (e.getAddedLayer() instanceof NoteLayer) noteLayerAdded.set(true);
        },
        activeLayerChange: function(e) {}, layerOrderChanged: function(e) {}
    }))();

    // --- Lógica de Cleanup do Contexto / Diálogo ---
    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        try {
            if (timerVerificacao) timerVerificacao.stop();
            if (notesJList && rendererOriginal) notesJList.setCellRenderer(rendererOriginal);
            if (layerHandler) MainApplication.getLayerManager().removeLayerChangeListener(layerHandler);
            if (changesetCacheListener) ChangesetCache.getInstance().removeChangesetCacheListener(changesetCacheListener);
            const mv = MainApplication.getMap() ? MainApplication.getMap().mapView : null;
            if (currentPainter && mv) mv.removeTemporaryLayer(currentPainter);
        } catch(err) {
            java.lang.System.err.println("Erro Resolver_Notas: " + err);
        }

        if (dialog) {
            try {
                const listeners = dialog.getWindowListeners();
                for (let i = 0; i < listeners.length; i++) {
                    dialog.removeWindowListener(listeners[i]);
                }
            } catch(e) {}
            if (windowAdapter) {
                try { dialog.removeWindowListener(windowAdapter); } catch(e) {}
                windowAdapter = null;
            }
            try { dialog.dispose(); } catch(e) {}
            dialog = null;
        }
    };

    if (typeof __josmContextResetHooks__ !== 'undefined') {
        __josmContextResetHooks__.register(cleanup);
    }
    if (typeof josmContextResetHooks !== 'undefined') {
        josmContextResetHooks.register(cleanup);
    }

    if (globalThis.__scriptCleanup__) {
        try { globalThis.__scriptCleanup__(); } catch(e) {}
    }
    if (globalThis.scriptCleanup) {
        try { globalThis.scriptCleanup(); } catch(e) {}
    }
    globalThis.__scriptCleanup__ = cleanup;
    globalThis.scriptCleanup = cleanup;

    // --- Inicialização Segura da UI ---
    SwingUtilities.invokeLater(function() {
        dialog = new JDialog(MainApplication.getMainFrame(), "Resolver_Notas", false);
        dialog.setLayout(new BorderLayout(8, 8));
        dialog.setSize(new Dimension(250, 350));
        dialog.setLocationRelativeTo(MainApplication.getMainFrame());

        const outerPanel = new JPanel(new BorderLayout(6, 6));
        outerPanel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        dialog.setContentPane(outerPanel);

        const capturePanel = new JPanel();
        capturePanel.setLayout(new BoxLayout(capturePanel, BoxLayout.Y_AXIS));

        const btnAdd = new JButton("Capturar Nota Selecionada");
        btnAdd.setAlignmentX(0.0);
        btnAdd.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));

        chkInject = new JCheckBox("Inserir comentário no changeset 📝", false);
        chkInject.setAlignmentX(0.0); 
        chkInject.setFont(chkInject.getFont().deriveFont(10.0));
        chkInject.setToolTipText("Preenche automaticamente o campo 'comment' do changeset com os IDs das notas");

        const chkCustomComment = new JCheckBox("Inserir comentário na nota 🚩", false);
        chkCustomComment.setAlignmentX(0.0);
        chkCustomComment.setFont(chkCustomComment.getFont().deriveFont(10.0));
        chkCustomComment.setToolTipText("Abre uma caixa de texto para adicionar um prefixo personalizado ao fechar a nota");

        capturePanel.add(btnAdd);
        capturePanel.add(chkInject);
        capturePanel.add(chkCustomComment);
        outerPanel.add(capturePanel, BorderLayout.NORTH);

        const listWrapper = new JPanel(new BorderLayout());
        listBorder = BorderFactory.createTitledBorder("Notas capturadas (0)");
        listWrapper.setBorder(listBorder);

        listPanel = new JPanel(new GridBagLayout());
        const scrollPane = new JScrollPane(listPanel);
        scrollPane.setBorder(BorderFactory.createEmptyBorder());
        listWrapper.add(scrollPane, BorderLayout.CENTER);
        outerPanel.add(listWrapper, BorderLayout.CENTER);

        updateUI = function() {
            listPanel.removeAll();
            listBorder.setTitle("Notas capturadas (" + rememberedNotes.length + ")");
            const gbc = new GridBagConstraints();
            gbc.fill = GridBagConstraints.HORIZONTAL; gbc.weightx = 1.0; gbc.insets = new Insets(2, 2, 2, 2); gbc.gridx = 0;
            rememberedNotes.forEach(function(item, index) {
                gbc.gridy = index;
                const itemPanel = new JPanel(new BorderLayout(6, 0));
                itemPanel.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createLineBorder(new Color(200, 200, 200)),
                    BorderFactory.createEmptyBorder(3, 6, 3, 6)
                ));
                const btnX = new JButton("x");
                btnX.setPreferredSize(new Dimension(24, 20));
                btnX.addActionListener(function() {
                    rememberedNotes.splice(index, 1);
					syncCapturedIds();																							  
                    updateUI(); refreshMap(); syncTags();
                    if (notesJList) notesJList.repaint();
                });
                const lbl = new JLabel("Nota #" + item.note.getId());
                lbl.setFont(lbl.getFont().deriveFont(Font.PLAIN, 11.0));
                if (item.comment) {
                    const infoLabel = new JLabel("ⓘ");
                    infoLabel.setForeground(new Color(0, 100, 200));
                    infoLabel.setToolTipText(item.comment);
                    itemPanel.add(infoLabel, BorderLayout.EAST);
                }
                itemPanel.add(btnX, BorderLayout.WEST);
                itemPanel.add(lbl, BorderLayout.CENTER);
                listPanel.add(itemPanel, gbc);
            });
            gbc.gridy = rememberedNotes.length; gbc.weighty = 1.0; listPanel.add(new JPanel(), gbc);
            listWrapper.revalidate(); listWrapper.repaint();
        };

        btnAdd.addActionListener(function() {
            const noteLayer = MainApplication.getLayerManager().getNoteLayer();
            if (!noteLayer) return;
            const selected = noteLayer.getNoteData().getSelectedNote();
            if (!selected) return;
            if (selected.getState().toString() === "CLOSED") {
                new Notification("Esta nota já está fechada.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                return; 
            }
            if (!rememberedNotes.some(function(n){ return n.note.getId() === selected.getId(); })) {
                let userComment = null;
                if (chkCustomComment.isSelected()) {
                    userComment = JOptionPane.showInputDialog(dialog, "Comentário para a nota #" + selected.getId() + ":", "Comentário Personalizado", JOptionPane.PLAIN_MESSAGE);
                    if (userComment === null) return; 
                    chkCustomComment.setSelected(false);
                }
                rememberedNotes.push({ note: selected, comment: userComment ? String(userComment).trim() : null });
                syncCapturedIds(); updateUI(); refreshMap(); syncTags();
                if (notesJList) notesJList.repaint();
            }
        });

        instalarRendererDestaque();
        MainApplication.getLayerManager().addLayerChangeListener(layerHandler);
        ChangesetCache.getInstance().addChangesetCacheListener(changesetCacheListener);
        windowAdapter = new (Java.extend(WindowAdapter, { windowClosing: function(e) { cleanup(); } }))();
        dialog.addWindowListener(windowAdapter);
        dialog.setVisible(true);
    });
})();