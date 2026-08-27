"use strict";

(function() {
    const MainApplication       = Java.type("org.openstreetmap.josm.gui.MainApplication");
    const Notification          = Java.type("org.openstreetmap.josm.gui.Notification");
    const UIManager             = Java.type("javax.swing.UIManager");
    const JDialog               = Java.type("javax.swing.JDialog");
    const JPanel                = Java.type("javax.swing.JPanel");
    const JLabel                = Java.type("javax.swing.JLabel");
    const JButton               = Java.type("javax.swing.JButton");
    const JScrollPane           = Java.type("javax.swing.JScrollPane");
    const ScrollPaneConstants   = Java.type("javax.swing.ScrollPaneConstants");
    const SwingConstants        = Java.type("javax.swing.SwingConstants");
    const WindowConstants       = Java.type("javax.swing.WindowConstants");
    const Box                   = Java.type("javax.swing.Box");
    const BorderLayout          = Java.type("java.awt.BorderLayout");
    const GridBagLayout         = Java.type("java.awt.GridBagLayout");
    const GridBagConstraints    = Java.type("java.awt.GridBagConstraints");
    const Insets                = Java.type("java.awt.Insets");
    const BoxLayout             = Java.type("javax.swing.BoxLayout");
    const Dimension             = Java.type("java.awt.Dimension");
    const Font                  = Java.type("java.awt.Font");
    const Color                 = Java.type("java.awt.Color");
    const Cursor                = Java.type("java.awt.Cursor");
    const BorderFactory         = Java.type("javax.swing.BorderFactory");
    const Toolkit               = Java.type("java.awt.Toolkit");
    const StringSelection       = Java.type("java.awt.datatransfer.StringSelection");
    const SwingUtilities        = Java.type("javax.swing.SwingUtilities");
    const Runnable              = Java.type("java.lang.Runnable");
    const OpenBrowser           = Java.type("org.openstreetmap.josm.tools.OpenBrowser");
    const Config                = Java.type("org.openstreetmap.josm.spi.preferences.Config");
    const ArrayList             = Java.type("java.util.ArrayList");

    // Classes Nativas do JOSM
    const HistoryDataSet        = Java.type("org.openstreetmap.josm.data.osm.history.HistoryDataSet");
    const HistoryLoadTask       = Java.type("org.openstreetmap.josm.gui.history.HistoryLoadTask");
    const HistoryDataSetListener= Java.type("org.openstreetmap.josm.data.osm.history.HistoryDataSetListener");
    const DataSelectionListener = Java.type("org.openstreetmap.josm.data.osm.DataSelectionListener");
    const MouseAdapter          = Java.extend(Java.type("java.awt.event.MouseAdapter"));

    // Busca de classes internas com fallback para compatibilidade de versões do JOSM
    function getJavaType(classNames) {
        for (let i = 0; i < classNames.length; i++) {
            try { return Java.type(classNames[i]); } catch(e) {}
        }
        return null;
    }

    const LayerChangeListener = getJavaType([
        "org.openstreetmap.josm.gui.layer.LayerManager$LayerChangeListener",
        "org.openstreetmap.josm.gui.layer.MainLayerManager$LayerChangeListener"
    ]);

    const ActiveLayerChangeListener = getJavaType([
        "org.openstreetmap.josm.gui.layer.MainLayerManager$ActiveLayerChangeListener",
        "org.openstreetmap.josm.gui.layer.LayerManager$ActiveLayerChangeListener"
    ]);

    // Não abre se não houver camada de edição ativa
    const activeEditDs = MainApplication.getLayerManager().getEditDataSet();
    if (!activeEditDs) {
        new Notification("Nenhuma camada de edição ativa no JOSM.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .setDuration(Notification.TIME_SHORT)
            .show();
        return;
    }

    // Faxina prévia de instâncias anteriores
    if (globalThis.scriptCleanup) {
        try { globalThis.scriptCleanup(); } catch(e) {}
    }
    if (globalThis.changesetToolCleanup) {
        try { globalThis.changesetToolCleanup(); } catch(e) {}
    }

    const RunnableClass = Java.extend(Runnable);
    function makeRunnable(fn) {
        return new RunnableClass({ run: fn });
    }

    let isCleanedUp = false;
    let cellRegistry = new Map();
    let pendingRequests = new Set();
    let currentDataSet = null;
    let activeLayerListenerRef = null;
    let layerListenerRef = null;

    globalThis._changesetToolState = {
        listeners: new ArrayList()
    };
    const strongListeners = globalThis._changesetToolState.listeners;

    function copiarTexto(texto) {
        try {
            const selection = new StringSelection(String(texto));
            Toolkit.getDefaultToolkit().getSystemClipboard().setContents(selection, null);
            new Notification("Copiado: " + texto)
                .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
                .setDuration(Notification.TIME_SHORT)
                .show();
        } catch(e) {
            java.lang.System.err.println("Erro ao copiar: " + e);
        }
    }

    // Configuração da Janela com Tamanho Fixo (4 colunas x 5 linhas visíveis base)
    const dialog = new JDialog(MainApplication.getMainFrame(), "Changesets por Objeto / Versão", false);
    dialog.setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);
    dialog.setLayout(new BorderLayout(0, 0));
    dialog.setSize(new Dimension(610, 320));
    dialog.setResizable(false);
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.getRootPane().putClientProperty("STRONG_LISTENERS", strongListeners);

    const headerPanel = new JPanel(new GridBagLayout());
    const matrixPanel = new JPanel(new GridBagLayout());
    const scrollPane = new JScrollPane(matrixPanel);
    
    scrollPane.setColumnHeaderView(headerPanel);

    scrollPane.getHorizontalScrollBar().setUnitIncrement(24);
    scrollPane.getVerticalScrollBar().setUnitIncrement(24);
    scrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED);
    scrollPane.setVerticalScrollBarPolicy(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED);
    scrollPane.setBorder(BorderFactory.createEmptyBorder(6, 6, 6, 6));

    dialog.add(scrollPane, BorderLayout.CENTER);

    function solicitarHistorico(prim) {
        if (!prim || prim.getId() <= 0) return;
        const primId = prim.getId();
        if (pendingRequests.has(primId)) return;

        pendingRequests.add(primId);
        try {
            const task = new HistoryLoadTask();
            task.add(prim);
            MainApplication.worker.submit(task);
        } catch(e) {
            pendingRequests.delete(primId);
        }
    }

    function createCellPanel(text, subText, isHeader, isBlank, url) {
        const pnl = new JPanel();
        pnl.setLayout(new BoxLayout(pnl, BoxLayout.Y_AXIS));
        pnl.setPreferredSize(new Dimension(135, 48));
        
        if (isBlank) {
            pnl.setBorder(BorderFactory.createDashedBorder(new Color(100, 100, 100)));
            const lblEmpty = new JLabel(text || "-");
            lblEmpty.setFont(new Font("SansSerif", Font.PLAIN, 11));
            lblEmpty.setForeground(new Color(120, 120, 120));
            lblEmpty.setHorizontalAlignment(SwingConstants.CENTER);
            lblEmpty.setAlignmentX(0.5);
            pnl.add(Box.createVerticalGlue());
            pnl.add(lblEmpty);
            pnl.add(Box.createVerticalGlue());
            return { panel: pnl, lblCS: null };
        }

        pnl.setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(isHeader ? new Color(120, 120, 120) : new Color(80, 80, 80), 1, true),
            BorderFactory.createEmptyBorder(3, 4, 3, 4)
        ));

        let formattedText = text;
        if (url) {
            formattedText = "<html><div style='text-align: center;'><a href='" + url + "' style='color: " + (isHeader ? "#ffb74d" : "#64b5f6") + ";'>" + text + "</a></div></html>";
        } else {
            formattedText = "<html><div style='text-align: center;'>" + text + "</div></html>";
        }

        const lbl = new JLabel(formattedText);
        lbl.setFont(new Font("SansSerif", isHeader ? Font.BOLD : Font.PLAIN, 11));
        lbl.setHorizontalAlignment(SwingConstants.CENTER);
        lbl.setAlignmentX(0.5);

        if (url) {
            lbl.setCursor(new Cursor(Cursor.HAND_CURSOR));
            lbl.addMouseListener(new MouseAdapter({
                mouseClicked: function(e) {
                    if (e.getClickCount() === 1) {
                        OpenBrowser.displayUrl(url);
                    }
                }
            }));
        }

        pnl.add(Box.createVerticalGlue());
        pnl.add(lbl);

        if (subText && subText.length > 0) {
            const lblSub = new JLabel("<html><div style='text-align: center;'>" + subText + "</div></html>");
            lblSub.setFont(new Font("SansSerif", Font.PLAIN, 8));
            lblSub.setForeground(new Color(160, 160, 160));
            lblSub.setHorizontalAlignment(SwingConstants.CENTER);
            lblSub.setAlignmentX(0.5);
            pnl.add(Box.createVerticalStrut(1));
            pnl.add(lblSub);
        }

        pnl.add(Box.createVerticalGlue());

        return { panel: pnl, lblCS: lbl };
    }

    function sincronizarDataSetListener() {
        if (isCleanedUp) return;
        const ds = MainApplication.getLayerManager().getEditDataSet();
        if (currentDataSet === ds) return;

        if (currentDataSet) {
            try { currentDataSet.removeSelectionListener(selectionListener); } catch(e) {}
        }
        currentDataSet = ds;
        if (currentDataSet) {
            try { currentDataSet.addSelectionListener(selectionListener); } catch(e) {}
        }
    }

    function atualizarInterface() {
        if (isCleanedUp) return;

        sincronizarDataSetListener();

        headerPanel.removeAll();
        matrixPanel.removeAll();
        cellRegistry.clear();

        const ds = MainApplication.getLayerManager().getEditDataSet();
        const selected = ds ? ds.getSelected() : null;

        const baseUrl = Config.getUrls().getBaseBrowseUrl();

        const primitives = [];
        let maxVer = 1;

        if (selected && !selected.isEmpty()) {
            const it = selected.iterator();
            while (it.hasNext()) {
                const p = it.next();
                primitives.push(p);
                if (p.getVersion() > maxVer) {
                    maxVer = p.getVersion();
                }
            }
        }

        const displayVers = Math.max(3, maxVer);
        const displayRows = Math.max(4, primitives.length);

        const gbc = new GridBagConstraints();
        gbc.insets = new Insets(3, 3, 3, 3);
        gbc.fill = GridBagConstraints.BOTH;

        // Cabeçalho Fixo
        gbc.gridx = 0; gbc.gridy = 0;
        const headObj = createCellPanel("Objeto / ID", null, true, false, null).panel;
        headerPanel.add(headObj, gbc);

        const colCSMap = {};
        for (let v = 1; v <= displayVers; v++) {
            colCSMap[v] = [];
            gbc.gridx = v;

            const headerBox = new JPanel();
            headerBox.setLayout(new BoxLayout(headerBox, BoxLayout.Y_AXIS));
            headerBox.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(110, 110, 110), 1, true),
                BorderFactory.createEmptyBorder(4, 4, 4, 4)
            ));
            headerBox.setPreferredSize(new Dimension(135, 52));

            const btnCopyCol = new JButton("📋 Copiar CS");
            btnCopyCol.setFont(new Font("SansSerif", Font.BOLD, 10));
            btnCopyCol.setAlignmentX(0.5);

            const hasActiveData = v <= maxVer && primitives.length > 0;
            btnCopyCol.setEnabled(hasActiveData);

            const lblVersion = new JLabel("Versão: v" + v);
            lblVersion.setFont(new Font("SansSerif", Font.BOLD, 11));
            lblVersion.setForeground(hasActiveData ? new Color(230, 130, 0) : new Color(140, 140, 140));
            lblVersion.setAlignmentX(0.5);

            headerBox.add(btnCopyCol);
            headerBox.add(Box.createVerticalStrut(2));
            headerBox.add(lblVersion);

            if (hasActiveData) {
                btnCopyCol.addActionListener((function(versionIndex) {
                    return function() {
                        if (isCleanedUp) return;
                        const list = colCSMap[versionIndex];
                        const validCS = [];
                        for (let i = 0; i < list.length; i++) {
                            const id = list[i].csId;
                            if (id > 0 && !validCS.includes(id)) {
                                validCS.push(id);
                            }
                        }
                        if (validCS.length > 0) {
                            copiarTexto(validCS.join(","));
                        } else {
                            new Notification("Nenum Changeset nesta coluna.")
                                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                        }
                    };
                })(v));
            }

            headerPanel.add(headerBox, gbc);
        }

        // Matriz de Dados
        for (let row = 0; row < displayRows; row++) {
            const hasPrim = row < primitives.length;
            const prim = hasPrim ? primitives[row] : null;
            const primId = prim ? prim.getId() : 0;
            const primType = prim ? prim.getType().getAPIName() : "";
            const currentVer = prim ? prim.getVersion() : 0;

            let historyMap = {};
            let userMap = {};
            let hasHistory = false;

            if (prim && primId > 0) {
                const history = HistoryDataSet.getInstance().getHistory(prim.getPrimitiveId());
                if (history != null && history.getNumVersions() > 0) {
                    pendingRequests.delete(primId);
                    try {
                        const count = history.getNumVersions();
                        for (let i = 0; i < count; i++) {
                            const hp = history.get(i);
                            if (hp) {
                                const verKey = String(hp.getVersion());
                                let csId = Number(hp.getChangesetId());
                                if (csId <= 0 && hp.getChangeset()) {
                                    csId = Number(hp.getChangeset().getId());
                                }

                                if (csId > 0) {
                                    historyMap[verKey] = csId;
                                    let uName = "";
                                    try {
                                        if (hp.getUser()) {
                                            uName = String(hp.getUser().getName());
                                        }
                                    } catch(ex) {}
                                    userMap[verKey] = uName;
                                    hasHistory = true;
                                }
                            }
                        }
                    } catch(e) {}
                }
            }

            gbc.gridx = 0; gbc.gridy = row;
            if (hasPrim) {
                const objLabelText = primType.toUpperCase() + " #" + (primId > 0 ? primId : "Novo");
                const objUrl = primId > 0 ? baseUrl + "/" + primType + "/" + primId : null;
                const objCell = createCellPanel(objLabelText, null, true, false, objUrl).panel;
                matrixPanel.add(objCell, gbc);
            } else {
                const emptyObjCell = createCellPanel("-", null, true, true, null).panel;
                matrixPanel.add(emptyObjCell, gbc);
            }

            for (let v = 1; v <= displayVers; v++) {
                gbc.gridx = v;

                if (hasPrim && v <= currentVer) {
                    let csId = historyMap[String(v)] || 0;
                    let userName = userMap[String(v)] || "";

                    if (csId === 0 && v === currentVer) {
                        csId = Number(prim.getChangesetId());
                        try {
                            if (prim.getUser()) {
                                userName = String(prim.getUser().getName());
                            }
                        } catch(ex) {}
                    }

                    let csText = csId > 0 ? "CS: #" + csId : (v === currentVer && csId === 0 ? "Sem CS" : "Carregando...");
                    let csUrl = csId > 0 ? baseUrl + "/changeset/" + csId : null;

                    const cellObj = createCellPanel(csText, userName, false, false, csUrl);
                    if (csId === 0 && v < currentVer) {
                        cellObj.lblCS.setForeground(new Color(130, 130, 130));
                    }

                    const cellData = { lblCS: cellObj.lblCS, csId: csId };
                    cellRegistry.set(primId + "_" + v, cellData);
                    colCSMap[v].push(cellData);

                    matrixPanel.add(cellObj.panel, gbc);
                } else {
                    const emptyCell = createCellPanel("-", null, false, true, null).panel;
                    matrixPanel.add(emptyCell, gbc);
                }
            }

            if (hasPrim && primId > 0 && currentVer > 1 && !hasHistory) {
                solicitarHistorico(prim);
            }
        }

        headerPanel.revalidate();
        headerPanel.repaint();
        matrixPanel.revalidate();
        matrixPanel.repaint();
    }

    const HistoryDataSetListenerClass = Java.extend(HistoryDataSetListener);
    const historyListener = new HistoryDataSetListenerClass({
        historyUpdated: function(source, primitiveId) {
            if (isCleanedUp) return;
            SwingUtilities.invokeLater(makeRunnable(function() {
                if (!isCleanedUp) atualizarInterface();
            }));
        },
        historyDataSetCleared: function(source) {
            if (isCleanedUp) return;
            SwingUtilities.invokeLater(makeRunnable(function() {
                if (!isCleanedUp) atualizarInterface();
            }));
        }
    });
    strongListeners.add(historyListener);
    HistoryDataSet.getInstance().addHistoryDataSetListener(historyListener);

    const DataSelectionListenerExtended = Java.extend(DataSelectionListener);
    const selectionListener = new DataSelectionListenerExtended({
        selectionChanged: function(e) {
            if (isCleanedUp) return;
            SwingUtilities.invokeLater(makeRunnable(function() {
                if (isCleanedUp) return;
                pendingRequests.clear();
                atualizarInterface();
            }));
        }
    });
    strongListeners.add(selectionListener);

    function onLayerStateChanged() {
        if (isCleanedUp) return;
        SwingUtilities.invokeLater(makeRunnable(function() {
            if (isCleanedUp) return;
            pendingRequests.clear();
            sincronizarDataSetListener();
            atualizarInterface();
        }));
    }

    if (LayerChangeListener) {
        const LayerChangeListenerExtended = Java.extend(LayerChangeListener);
        layerListenerRef = new LayerChangeListenerExtended({
            layerAdded: function(e) { onLayerStateChanged(); },
            layerRemoving: function(e) { onLayerStateChanged(); },
            layerOrderChanged: function(e) { onLayerStateChanged(); }
        });
        strongListeners.add(layerListenerRef);
        try { MainApplication.getLayerManager().addLayerChangeListener(layerListenerRef); } catch(e) {}
    }

    if (ActiveLayerChangeListener) {
        const ActiveLayerChangeListenerExtended = Java.extend(ActiveLayerChangeListener);
        activeLayerListenerRef = new ActiveLayerChangeListenerExtended({
            activeLayerChange: function(e) { onLayerStateChanged(); }
        });
        strongListeners.add(activeLayerListenerRef);
        try { MainApplication.getLayerManager().addActiveLayerChangeListener(activeLayerListenerRef); } catch(e) {}
    }

    function encerrarDialogo() {
        if (isCleanedUp) return;
        isCleanedUp = true;
        
        cellRegistry.clear();
        pendingRequests.clear();

        try { HistoryDataSet.getInstance().removeHistoryDataSetListener(historyListener); } catch(e) {}
        try {
            if (currentDataSet) currentDataSet.removeSelectionListener(selectionListener);
            const editDs = MainApplication.getLayerManager().getEditDataSet();
            if (editDs) editDs.removeSelectionListener(selectionListener);
        } catch(e) {}
        try {
            if (layerListenerRef) MainApplication.getLayerManager().removeLayerChangeListener(layerListenerRef);
        } catch(e) {}
        try {
            if (activeLayerListenerRef) MainApplication.getLayerManager().removeActiveLayerChangeListener(activeLayerListenerRef);
        } catch(e) {}

        strongListeners.clear();
        delete globalThis._changesetToolState;
        
        if (dialog) {
            try {
                const listeners = dialog.getWindowListeners();
                for (let i = 0; i < listeners.length; i++) {
                    dialog.removeWindowListener(listeners[i]);
                }
            } catch(e) {}
            try {
                dialog.dispose();
            } catch(e) {}
        }
    }

    const cleanup = encerrarDialogo;

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
    globalThis.changesetToolCleanup = cleanup;

    const WindowAdapter = Java.extend(Java.type("java.awt.event.WindowAdapter"));
    dialog.addWindowListener(new WindowAdapter({
        windowClosing: function(e) { cleanup(); },
        windowClosed:  function(e) { cleanup(); }
    }));

    sincronizarDataSetListener();
    atualizarInterface();
    dialog.setVisible(true);
})();