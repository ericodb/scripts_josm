"use strict"; 
 
import { println } from 'josm/scriptingconsole'; 
 
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication"); 
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification"); 
const UIManager       = Java.type("javax.swing.UIManager"); 
const OsmApi          = Java.type("org.openstreetmap.josm.io.OsmApi"); 
const Config          = Java.type("org.openstreetmap.josm.spi.preferences.Config"); 
 
const JDialog         = Java.type("javax.swing.JDialog"); 
const JPanel          = Java.type("javax.swing.JPanel"); 
const JLabel          = Java.type("javax.swing.JLabel"); 
const JButton         = Java.type("javax.swing.JButton"); 
const JCheckBox       = Java.type("javax.swing.JCheckBox"); 
const JTextField      = Java.type("javax.swing.JTextField"); 
const JScrollPane     = Java.type("javax.swing.JScrollPane"); 
const JOptionPane     = Java.type("javax.swing.JOptionPane");
const BoxLayout       = Java.type("javax.swing.BoxLayout"); 
const BorderLayout    = Java.type("java.awt.BorderLayout"); 
const BorderFactory   = Java.type("javax.swing.BorderFactory"); 
const GridBagLayout   = Java.type("java.awt.GridBagLayout"); 
const GridBagConstraints = Java.type("java.awt.GridBagConstraints"); 
const Insets          = Java.type("java.awt.Insets"); 
const Dimension       = Java.type("java.awt.Dimension"); 
const Font            = Java.type("java.awt.Font"); 
const Color           = Java.type("java.awt.Color"); 
const Timer           = Java.type("javax.swing.Timer"); 
const SwingUtilities  = Java.type("javax.swing.SwingUtilities"); 
const ChangesetCache         = Java.type("org.openstreetmap.josm.data.osm.ChangesetCache"); 
const ChangesetCacheListener = Java.type("org.openstreetmap.josm.data.osm.ChangesetCacheListener"); 
const OsmDataLayer           = Java.type("org.openstreetmap.josm.gui.layer.OsmDataLayer"); 
const LayerChangeListener    = Java.type("org.openstreetmap.josm.gui.layer.LayerManager.LayerChangeListener"); 
 
const WindowAdapter          = Java.type("java.awt.event.WindowAdapter"); 
const ActionListener         = Java.type("java.awt.event.ActionListener"); 
const AtomicBoolean          = Java.type("java.util.concurrent.atomic.AtomicBoolean"); 
const ConcurrentHashMap      = Java.type("java.util.concurrent.ConcurrentHashMap"); 
 
function iniciarScript() { 
    let layer = MainApplication.getLayerManager().getEditLayer(); 
    if (!layer) { 
        new Notification("Nenhuma camada de edição ativa.") 
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show(); 
        return; 
    } 
 
    let listaGrupos = []; 
    let lastChangesetId     = null; 
    let lastLayer           = layer; 
    let janelaReverterAberta = false; 
    let idsCandidatos        = ""; 
    let ultimoReverterWin    = null;
    let temConflito          = false;  
 
	// Variáveis thread-safe para comunicação segura entre o listener de background e a UI																											  
    const pendingUploadId = { id: null }; 
    const triggerUploadNotification = new AtomicBoolean(false); 
    const activeUploadChangesets = new ConcurrentHashMap(); 
    const temPendenciasFlag = new AtomicBoolean(false); 
 
    const atualizarPendencias = function() { 
        temPendenciasFlag.set(listaGrupos.length > 0); 
    }; 
 
    // Função para limpar o estado da sessão/camada 
    const limparEstadoCompleto = function() { 
        listaGrupos          = []; 
        lastChangesetId      = null; 
        pendingUploadId.id   = null; 
        idsCandidatos        = ""; 
        janelaReverterAberta = false; 
        temConflito          = false; 
        txtNovoUpload.setText(""); 
        activeUploadChangesets.clear(); 
        atualizarPendencias(); 
        lastLayer = MainApplication.getLayerManager().getEditLayer(); 
        updateUI(); 
        syncTags(); 
    }; 
 
	// Formata grupo para exibição: 3 IDs por linha 
    function formatarGrupo(ids) { 
        const linhas = []; 
        for (let i = 0; i < ids.length; i += 3) { 
            linhas.push(ids.slice(i, i + 3).join(";")); 
        } 
        return linhas.join("<br>"); 
    } 
 
	// Todos os IDs únicos de todos os grupos													   
    function todosIds() { 
        const set = new Set(); 
        listaGrupos.forEach(grupo => grupo.ids.forEach(id => set.add(id))); 
        return Array.from(set); 
    } 
 
	// Sync das tags do changeset									 
    const syncTags = function() { 
        const ds = MainApplication.getLayerManager().getEditDataSet(); 
        if (!ds) return; 
        const ids = todosIds(); 
	// Se houver conflito ativo, bloqueia a injeção de tags para evitar corromper o estado do dataset																									    
        if (chkInjectId.isSelected() && ids.length > 0 && !temConflito) { 
            ds.addChangeSetTag("revert:id", ids.join(";")); 
        } else { 
            ds.addChangeSetTag("revert:id", null); 
        } 
        if (chkInjectComment.isSelected() && ids.length > 0 && !temConflito) { 
            ds.addChangeSetTag("comment", "Revertendo changeset " + ids.join(", ")); 
        } else { 
            ds.addChangeSetTag("comment", null); 
        } 
    }; 
 
	// Atualiza lista visual							   
    const updateUI = function() { 
        listPanel.removeAll(); 
         
        if (temConflito) { 
            listBorder = BorderFactory.createTitledBorder(null, "⚠ Conflito detetado! Resolva no mapa", 0, 0, null, new Color(200, 0, 0)); 
        } else { 
            listBorder = BorderFactory.createTitledBorder(null, "ID's dos Changesets Revertidos (" + listaGrupos.length + ")", 0, 0, null, null); 
        } 
        listWrapper.setBorder(listBorder); 
 
        const gbc = new GridBagConstraints(); 
        gbc.fill = GridBagConstraints.HORIZONTAL; 
        gbc.weightx = 1.0; 
        gbc.insets = new Insets(2, 2, 2, 2); 
        gbc.gridx = 0; 
 
        listaGrupos.forEach(function(grupo, index) { 
            gbc.gridy = index; 
            gbc.weighty = 0.0; 
 
            const itemPanel = new JPanel(new BorderLayout(6, 0)); 
            itemPanel.setBorder(BorderFactory.createCompoundBorder( 
                BorderFactory.createLineBorder(new Color(200, 200, 200)), 
                BorderFactory.createEmptyBorder(3, 6, 3, 6) 
            )); 
 
            const btnX = new JButton("x"); 
            btnX.setPreferredSize(new Dimension(22, 20)); 
            btnX.setFont(btnX.getFont().deriveFont(Font.BOLD, 10.0)); 
            btnX.setToolTipText("Remover este grupo (" + grupo.ids.length + " ID(s))"); 
            btnX.addActionListener(new (Java.extend(ActionListener, { actionPerformed: function() { 
                listaGrupos.splice(index, 1); 
                atualizarPendencias(); 
                updateUI(); 
                syncTags(); 
            }}))()); 
 
            const lbl = new JLabel("<html>" + formatarGrupo(grupo.ids) + "</html>"); 
            lbl.setFont(lbl.getFont().deriveFont(Font.PLAIN, 11.0)); 
 
            // Painel lateral para as opções (Parcial e Texto extra)
            const rightPanel = new JPanel();
            rightPanel.setLayout(new BoxLayout(rightPanel, BoxLayout.Y_AXIS));

            // Checkbox para definir Reversão Parcial por grupo 
            const chkParcial = new JCheckBox("Parcial", grupo.parcial); 
            chkParcial.setFont(chkParcial.getFont().deriveFont(10.0)); 
            chkParcial.setToolTipText("Marcar se a reversão deste grupo foi apenas parcial"); 
            chkParcial.addActionListener(new (Java.extend(ActionListener, { actionPerformed: function() { 
                grupo.parcial = chkParcial.isSelected(); 
            }}))()); 

            // Checkbox para texto extra acima do comentário
            const chkTextoExtra = new JCheckBox("Texto extra", grupo.textoExtra ? true : false); 
            chkTextoExtra.setFont(chkTextoExtra.getFont().deriveFont(10.0)); 
            chkTextoExtra.setToolTipText("Adicionar texto extra acima do comentário de reversão"); 
            chkTextoExtra.addActionListener(new (Java.extend(ActionListener, { actionPerformed: function() { 
                if (chkTextoExtra.isSelected()) { 
                    const input = JOptionPane.showInputDialog(dialog, "Digite o texto extra para o comentário:", grupo.textoExtra || ""); 
                    if (input !== null && String(input).trim() !== "") { 
                        grupo.textoExtra = String(input).trim(); 
                    } else { 
                        grupo.textoExtra = ""; 
                        chkTextoExtra.setSelected(false); 
                    } 
                } else { 
                    grupo.textoExtra = ""; 
                } 
            }}))()); 

            rightPanel.add(chkParcial);
            rightPanel.add(chkTextoExtra);
 
            itemPanel.add(btnX, BorderLayout.WEST); 
            itemPanel.add(lbl, BorderLayout.CENTER); 
            itemPanel.add(rightPanel, BorderLayout.EAST); 
            listPanel.add(itemPanel, gbc); 
        }); 
 
		// Filler	   
        gbc.gridy = listaGrupos.length; 
        gbc.weighty = 1.0; 
        listPanel.add(new JPanel(), gbc); 
 
        listWrapper.revalidate(); 
        listWrapper.repaint(); 
    }; 
 
	// Envio de comentários em todos os IDs acumulados																   
    const dispararComentarios = function(novoUploadId) { 
        if (listaGrupos.length === 0 || !novoUploadId) return; 
 
        const prefKey = 'oauth.access-token.object.OAuth20.api.openstreetmap.org'; 
        const prefValue = Config.getPref().get(prefKey); 
        if (!prefValue) { 
            new Notification("Erro: Autenticação OAuth2 não encontrada.") 
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show(); 
            return; 
        } 
 
        let oauthToken; 
        try { 
            oauthToken = JSON.parse(prefValue).access_token; 
        } catch (e) { 
            println("❌ Erro ao processar credenciais: " + e); 
            return; 
        } 
 
        const baseUrl = OsmApi.getOsmApi().getBaseUrl(); 
        let successes = 0; 
 
        // Mapeia cada ID para o seu estado de reversão (parcial ou total) e texto extra
        const mapIds = new Map(); 
        listaGrupos.forEach(grupo => { 
            grupo.ids.forEach(id => { 
                const infoAnterior = mapIds.get(id) || { parcial: false, textoExtra: "" }; 
                mapIds.set(id, {
                    parcial: infoAnterior.parcial || grupo.parcial,
                    textoExtra: grupo.textoExtra ? grupo.textoExtra : infoAnterior.textoExtra
                }); 
            }); 
        }); 
 
        mapIds.forEach(function(info, idStr) { 
            const cId = parseInt(idStr, 10); 
            if (isNaN(cId)) return; 
 
            let comentario = info.parcial 
                ? "Este changeset foi revertido parcialmente com changeset/" + novoUploadId 
                : "Este changeset foi revertido com changeset/" + novoUploadId; 
 
            if (info.textoExtra) {
                comentario = info.textoExtra + "\n" + comentario;
            }

            try { 
                const url = new java.net.URL(baseUrl + "changeset/" + cId + "/comment"); 
                const conn = url.openConnection(); 
                conn.setRequestMethod("POST"); 
                conn.setRequestProperty("Authorization", "Bearer " + oauthToken); 
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded"); 
                conn.setRequestProperty("User-Agent", "JOSM-Reverter-Automation-Script/1.0"); 
                conn.setDoOutput(true); 
                const params = "text=" + java.net.URLEncoder.encode(comentario, "UTF-8"); 
                const os = conn.getOutputStream(); 
                const writer = new java.io.OutputStreamWriter(os, "UTF-8"); 
                writer.write(params); 
                writer.flush(); 
                writer.close(); 
                os.close(); 
                if (conn.getResponseCode() === 200) { 
                    successes++; 
                } else { 
                    println("Erro API OSM (Changeset " + cId + "): HTTP " + conn.getResponseCode()); 
                } 
            } catch (err) { 
                println("Falha na conexão com changeset " + cId + ": " + err); 
            } 
        }); 
 
        if (successes > 0) { 
            new Notification(successes + " comentário(s) enviado(s) com sucesso!") 
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show(); 
            listaGrupos = []; 
            temConflito = false; 
            atualizarPendencias(); 
            updateUI(); 
            syncTags(); 
        } else { 
            new Notification("Falha ao comentar. Verifique o Console do JOSM.") 
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show(); 
        } 
    }; 
 
    // Aguarda o PleaseWaitDialog fechar e aplica 400ms para a UI desenhar a notificação nativa 
    const aguardarFimUploadEDisparar = function(id) { 
        const check = new Timer(150, new (Java.extend(ActionListener, { 
            actionPerformed: function(e) { 
                const windows = java.awt.Window.getWindows(); 
                let uploading = false; 
                for (let i = 0; i < windows.length; i++) { 
                    const w = windows[i]; 
                    if (w && w.isVisible() && w.getClass().getSimpleName() === "PleaseWaitDialog") { 
                        uploading = true; 
                        break; 
                    } 
                } 
                if (!uploading) { 
                    e.getSource().stop(); 
                    const visualDelay = new Timer(400, new (Java.extend(ActionListener, { 
                        actionPerformed: function(evt) { 
                            evt.getSource().stop(); 
                            dispararComentarios(id); 
                        } 
                    }))()); 
                    visualDelay.setRepeats(false); 
                    visualDelay.start(); 
                } 
            } 
        }))()); 
        check.setRepeats(true); 
        check.start(); 
    }; 
 
	// ChangesetCacheListener blindado contra histórico															   
    const changesetCacheListener = new (Java.extend(ChangesetCacheListener, { 
        changesetCacheUpdated: function(event) { 
            try { 
				// 1. Rastreia apenas os changesets que abrem enquanto temos IDs para reverter																					    
                if (!temPendenciasFlag.get()) return; 
 
                const added = event.getAddedChangesets().iterator(); 
                while (added.hasNext()) { 
                    let cs = added.next(); 
                    if (cs.isOpen()) { 
                        activeUploadChangesets.put(String(cs.getId()), true); 
                    } 
                } 
 
				// 2. Só aceita o fechamento se o changeset estava na lista de abertos																			    
                const updated = event.getUpdatedChangesets().iterator(); 
                while (updated.hasNext()) { 
                    let cs = updated.next(); 
                    let csIdStr = String(cs.getId()); 
                     
                    if (!cs.isOpen() && activeUploadChangesets.containsKey(csIdStr)) { 
                        activeUploadChangesets.remove(csIdStr); 
						// Se estiver em conflito, ignora o fecho automático do changeset atual																		 
                        if (!temConflito && csIdStr !== lastChangesetId) { 
                            lastChangesetId = csIdStr; 
                            pendingUploadId.id = csIdStr; 
                            triggerUploadNotification.set(true); 
                        } 
                    } 
                } 
            } catch (e) { 
                println("Erro Reverter ao processar ChangesetCacheEvent: " + e); 
            } 
        } 
    }))(); 
 
    // Listener de camadas para limpar imediatamente ao remover a camada 
    const layerHandler = new (Java.extend(LayerChangeListener, { 
        layerRemoving: function(e) { 
            if (e.getRemovedLayer() instanceof OsmDataLayer) { 
                SwingUtilities.invokeLater(function() { 
                    limparEstadoCompleto(); 
                }); 
            } 
        }, 
        layerAdded: function(e) {}, 
        layerOrderChanged: function(e) {} 
    }))(); 
 
	// Monitoramento de janelas 
    const monitorarJanelas = function() { 
        const windows = java.awt.Window.getWindows(); 
        let reverterVisivelNesteTick = false; 
        let conflitoVisivelNesteTick = false; 
        let uploadDialogVisivelNesteTick = false; 
 
        for (let i = 0; i < windows.length; i++) { 
            const win = windows[i]; 
            if (!win || !win.isVisible()) continue; 
            const winClass = win.getClass().getSimpleName(); 
             
			// Deteta o diálogo de conflito gerado pelo JOSM (HTTP 409)															 
            if (winClass.match(/JOptionPane|HelpAwareOptionPane/i)) { 
                try { 
                    const title = String(win.getTitle() || ""); 
                    if (title.match(/Conflict|Conflito/i)) { 
                        conflitoVisivelNesteTick = true; 
                    } 
                } catch(e) {} 
            } 
 
            if (winClass === "UploadDialog") { 
                uploadDialogVisivelNesteTick = true; 
            } 
 
            if (winClass.match(/HistoryBrowserDialog|NotePopup|OSMObjInfoDialog|ValidatorDialog|Notification/i)) continue; 
 
			// Captura IDs do plugin Reverter								  
            if (winClass === "ChangesetIdQuery") { 
                reverterVisivelNesteTick = true; 
                ultimoReverterWin = win;
                const extrairId = function(comp) { 
                    try { 
                        if (comp.getClass().getSimpleName() === "ChangesetIdsTextField") { 
                            idsCandidatos = String(comp.getText()).trim(); 
                        } 
                        if (comp.getComponents) { 
                            const children = comp.getComponents(); 
                            for (let j = 0; j < children.length; j++) extrairId(children[j]); 
                        } 
                    } catch(e) {} 
                }; 
                extrairId(win); 
                continue; 
            } 
        } 
 
		// Se ocorreu conflito, bloqueia a limpeza automática e protege os dados																		  
        if (conflitoVisivelNesteTick && !temConflito) { 
            temConflito = true; 
            activeUploadChangesets.clear(); 
            SwingUtilities.invokeLater(function() { updateUI(); syncTags(); }); 
        } 
 
		// Se estava em conflito, mas o utilizador abriu um novo UploadDialog após corrigir, destrava automaticamente																											   
        if (temConflito && uploadDialogVisivelNesteTick) { 
            temConflito = false; 
            SwingUtilities.invokeLater(function() {  
                updateUI();  
                syncTags(); 
                new Notification("Conflito ultrapassado. Tags de reestruturação re-aplicadas.") 
                    .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show(); 
            }); 
        } 
 
		// Processa ao fechar a janela do reverter									 
        if (reverterVisivelNesteTick) { 
            janelaReverterAberta = true; 
        } else if (janelaReverterAberta) { 
            janelaReverterAberta = false; 
            let foiConfirmado = true;
            if (ultimoReverterWin) {
                try {
                    if (typeof ultimoReverterWin.getValue === "function") {
                        foiConfirmado = (ultimoReverterWin.getValue() === 1);
                    }
                } catch(e) {}
            }

            if (foiConfirmado && idsCandidatos) {
                const novosIds = idsCandidatos.split(/[;,]/) 
                    .map(function(s) { return s.trim(); }) 
                    .filter(function(s) { return s !== ""; }); 
                if (novosIds.length > 0) { 
                    const chave    = novosIds.slice().sort().join(";"); 
                    const jaExiste = listaGrupos.some(function(g) { 
                        return g.ids.slice().sort().join(";") === chave; 
                    }); 
                    if (!jaExiste) { 
                        listaGrupos.push({ ids: novosIds, parcial: false, textoExtra: "" }); 
                        atualizarPendencias(); 
                        SwingUtilities.invokeLater(function() { updateUI(); syncTags(); }); 
                    } 
                } 
            } 
            idsCandidatos = "";
            ultimoReverterWin = null;
        } 
    }; 
 
	// Interface			   
    const parent = MainApplication.getMainFrame(); 
    const dialog = new JDialog(parent, "Complemento do Plugin Reverter", false); 
    dialog.setLayout(new BorderLayout(8, 8)); 
    dialog.setLocationRelativeTo(parent); 
 
    const outerPanel = new JPanel(new BorderLayout(6, 6)); 
    outerPanel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8)); 
    dialog.setContentPane(outerPanel); 
 
	// Checkboxes			    
    const chkInjectId = new JCheckBox("Inserir revert:id no changeset", true); 
    chkInjectId.setFont(chkInjectId.getFont().deriveFont(11.0)); 
    const chkInjectComment = new JCheckBox("Inserir comentário no changeset", true); 
    chkInjectComment.setFont(chkInjectComment.getFont().deriveFont(11.0)); 
 
    chkInjectId.addActionListener(new (Java.extend(ActionListener, { actionPerformed: function() { syncTags(); } }))()); 
    chkInjectComment.addActionListener(new (Java.extend(ActionListener, { actionPerformed: function() { syncTags(); } }))()); 
 
	// Campo novo upload						  
    const uploadPanel = new JPanel(new BorderLayout(4, 4)); 
    uploadPanel.setBorder(BorderFactory.createTitledBorder("ID do Novo Upload (Automático)")); 
    const txtNovoUpload = new JTextField(); 
    txtNovoUpload.setEditable(false); 
    uploadPanel.add(txtNovoUpload, BorderLayout.CENTER); 
    const chkPanel = new JPanel(); 
    chkPanel.setLayout(new BoxLayout(chkPanel, BoxLayout.Y_AXIS)); 
    chkPanel.add(chkInjectId); 
    chkPanel.add(chkInjectComment); 
 
	// Texto de aviso					  
    const lblAviso = new JLabel("<html><font color='red'><b>Reverter no máximo 20 changesets por vez.<br>"+ 
                    "Evita erro no limíte de caracteres (Máx. 255)</b></font></html>"); 
    lblAviso.setFont(lblAviso.getFont().deriveFont(10.5)); 
    lblAviso.setBorder(BorderFactory.createEmptyBorder(4, 2, 2, 0)); 
    chkPanel.add(lblAviso); 
 
    uploadPanel.add(chkPanel, BorderLayout.SOUTH); 
    outerPanel.add(uploadPanel, BorderLayout.NORTH); 
 
	// Lista de grupos					  
    const listWrapper = new JPanel(new BorderLayout()); 
    let listBorder = BorderFactory.createTitledBorder("ID's dos Changesets Revertidos (0)"); 
    listWrapper.setBorder(listBorder); 
 
    const listPanel = new JPanel(new GridBagLayout()); 
    const scrollPane = new JScrollPane(listPanel); 
    scrollPane.setBorder(BorderFactory.createEmptyBorder()); 
    scrollPane.setPreferredSize(new Dimension(280, 140)); 
    listWrapper.add(scrollPane, BorderLayout.CENTER); 
    outerPanel.add(listWrapper, BorderLayout.CENTER); 
 
	// Timer consome flags thread-safe e evita property change do AWT																					   
    const monitorTimer = new Timer(1000, new (Java.extend(ActionListener, { actionPerformed: function() { 
        if (!dialog.isVisible()) { monitorTimer.stop(); return; } 
 
        if (triggerUploadNotification.getAndSet(false) && !temConflito) { 
            const id = pendingUploadId.id; 
            if (id) { 
                txtNovoUpload.setText(id); 
                new Notification("Upload detectado: " + id + ". Enviando comentários...") 
                    .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show(); 
 
				// Usa o poller dinâmico do PleaseWaitDialog 
                aguardarFimUploadEDisparar(id); 
            } 
        } 
 
        monitorarJanelas(); 
    }}))()); 
    monitorTimer.start(); 
 
    ChangesetCache.getInstance().addChangesetCacheListener(changesetCacheListener); 
    MainApplication.getLayerManager().addLayerChangeListener(layerHandler); 

    let isCleanedUp = false;
    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        try { if (monitorTimer) monitorTimer.stop(); } catch(e) {}
        try { ChangesetCache.getInstance().removeChangesetCacheListener(changesetCacheListener); } catch(e) {}
        try { MainApplication.getLayerManager().removeLayerChangeListener(layerHandler); } catch(e) {}
        try {
            const ds = MainApplication.getLayerManager().getEditDataSet();
            if (ds) ds.addChangeSetTag("revert:id", null);
        } catch(e) {}

        if (dialog) {
            try {
                const listeners = dialog.getWindowListeners();
                for (let i = 0; i < listeners.length; i++) {
                    dialog.removeWindowListener(listeners[i]);
                }
            } catch(e) {}
            try { dialog.dispose(); } catch(e) {}
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

    dialog.addWindowListener(new (Java.extend(WindowAdapter, { windowClosing: function() { 
        cleanup();
    }}))()); 

    updateUI(); 
    dialog.pack(); 
    dialog.setLocationRelativeTo(parent); 
    dialog.setVisible(true); 
} 
 
iniciarScript();
