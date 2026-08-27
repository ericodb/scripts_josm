"use strict";

// --- IMPORTS JAVA ---
const Way = Java.type("org.openstreetmap.josm.data.osm.Way");
const Node = Java.type("org.openstreetmap.josm.data.osm.Node");
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification = Java.type("org.openstreetmap.josm.gui.Notification");
const LatLon = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const AddCommand = Java.type("org.openstreetmap.josm.command.AddCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const ImageProvider = Java.type("org.openstreetmap.josm.tools.ImageProvider");

const {
    JPanel, UIManager, JButton, JTextField, JLabel, JRadioButton, 
    ButtonGroup, JSpinner, SpinnerNumberModel, JDialog, BorderFactory,
    JCheckBox
} = typeof javax !== 'undefined' ? javax.swing : {};
const { GridBagLayout, GridBagConstraints, Insets, BorderLayout, Dimension } = typeof java !== 'undefined' ? java.awt : {};
const ArrayList = Java.type("java.util.ArrayList");
const WindowAdapter = Java.extend(Java.type("java.awt.event.WindowAdapter"));

// --- ESTADO GLOBAL ---
var state = {
    off_p: 5.0, off_a: 5.0,
    rep_p: 1, rep_a: 1,
    step_p: 0.5, step_a: 0.5,
    ultimo_cmd: null,
    total_criado: 0,
    sobrepor_mesmo_lado: false
};

// --- FUNÇÃO PARA CALCULAR DESLOCAMENTO ---
function calcular_deslocamento(larg, off, rep, sobrepor_mesmo_lado) {
    if (sobrepor_mesmo_lado) {
        return (larg + off) * rep;
    } else {
        if (off >= 0) {
            return (larg + off) * rep;
        } else {
            return (-larg + off) * rep;
        }
    }
}

// --- LÓGICA DE CRIAÇÃO ---
function executar_criacao(modo, off_p, off_a, rep_p, rep_a, sobrepor_mesmo_lado) {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer) return;
    
    const dataset = layer.data;
    const sel = dataset.getSelected();
    
    let nodes_ref = [], ways = [];
    let it = sel.iterator();
    while (it.hasNext()) {
        let item = it.next();
        if (item instanceof Node) nodes_ref.push(item);
        else if (item instanceof Way) ways.push(item);
    }

    if (nodes_ref.length < 2 || ways.length === 0) return;

    const uh = UndoRedoHandler.getInstance();
    if (state.ultimo_cmd && uh.getUndoCommands().contains(state.ultimo_cmd)) {
        uh.undo();
    }
    state.ultimo_cmd = null;

    const n1 = nodes_ref[0], n2 = nodes_ref[1];
    const l1 = n1.getCoor().lat(), o1 = n1.getCoor().lon();
    const l2 = n2.getCoor().lat(), o2 = n2.getCoor().lon();
    
    const m_lat = 111320.0;
    const m_lon = m_lat * Math.cos((l1 + l2) / 2.0 * Math.PI / 180.0);
    const dx = (o2 - o1) * m_lon, dy = (l2 - l1) * m_lat;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
        
    const ux = dx/dist, uy = dy/dist;
    const nx = -uy, ny = ux;

    // Coleta todos os nós únicos de todas as ways selecionadas
    let todos_nos = new java.util.HashSet();
    ways.forEach(function(w) { 
        let wn = w.getNodes();
        for (let i = 0; i < wn.size(); i++) {
            let n = wn.get(i);
            if (n !== null && !n.isDeleted()) {
                todos_nos.add(n);
            }
        }
    });

    // Verifica se todos os nós têm coordenadas válidas
    let itCheck = todos_nos.iterator();
    while (itCheck.hasNext()) {
        let n = itCheck.next();
        if (n.getCoor() === null) return;
    }

    let min_p = null, max_p = null, min_a = null, max_a = null;
    let itN = todos_nos.iterator();
    while(itN.hasNext()){
        let node = itN.next();
        let coor = node.getCoor();
        if (coor === null) continue;
        let dxn = (coor.lon() - o1) * m_lon;
        let dyn = (coor.lat() - l1) * m_lat;
        let p_p = dxn * nx + dyn * ny;
        let p_a = dxn * ux + dyn * uy;
        if (min_p === null || p_p < min_p) min_p = p_p;
        if (max_p === null || p_p > max_p) max_p = p_p;
        if (min_a === null || p_a < min_a) min_a = p_a;
        if (max_a === null || p_a > max_a) max_a = p_a;
    }

    if (min_p === null || min_a === null) return;

    const larg = Math.abs(max_p - min_p);
    const comp = Math.abs(max_a - min_a);

    let cmds = new ArrayList();
    let r_p_max = (modo === "Ambos" || modo === "Perp") ? rep_p : 0;
    let r_a_max = (modo === "Ambos" || modo === "Para") ? rep_a : 0;

    // Cache de nós por posição usando Map JS (evita confusão com null do Java)
    let nodeByPos = {};

    function makeKey(lat, lon) {
        return (Math.round(lat * 1e7) / 1e7).toFixed(7) + "|" +
               (Math.round(lon * 1e7) / 1e7).toFixed(7);
    }

    // Popula cache com nós existentes não deletados
    let allNodes = dataset.getNodes();
    let itAll = allNodes.iterator();
    while (itAll.hasNext()) {
        let n = itAll.next();
        if (n.isDeleted()) continue;
        let coor = n.getCoor();
        if (coor === null) continue;
        let key = makeKey(coor.lat(), coor.lon());
        nodeByPos[key] = n;
    }

    // Obtém nó existente ou cria novo — usa objeto JS puro (sem HashMap Java)
    function getOrCreateNode(lat, lon) {
        let key = makeKey(lat, lon);
        let existing = nodeByPos[key];
        if (existing !== undefined && existing !== null && !existing.isDeleted()) {
            return existing;
        }
        let nn = new Node(new LatLon(lat, lon));
        cmds.add(new AddCommand(dataset, nn));
        nodeByPos[key] = nn;
        return nn;
    }

    let count = 0;
    for (let rp = 0; rp <= r_p_max; rp++) {
        for (let ra = 0; ra <= r_a_max; ra++) {
            if (rp === 0 && ra === 0) continue;
            
            let cp = calcular_deslocamento(larg, off_p, rp, sobrepor_mesmo_lado);
            let ca = calcular_deslocamento(comp, off_a, ra, sobrepor_mesmo_lado);
            
            if (Math.abs(cp) < 1e-4 && Math.abs(ca) < 1e-4) continue;
            
            let d_lon = (nx * cp + ux * ca) / m_lon;
            let d_lat = (ny * cp + uy * ca) / m_lat;

            // Mapeia nós originais → nós deslocados usando Map JS
            let mapN = {};

            let itN2 = todos_nos.iterator();
            while (itN2.hasNext()) {
                let n = itN2.next();
                let coor = n.getCoor();
                if (coor === null) continue;
                let newLat = coor.lat() + d_lat;
                let newLon = coor.lon() + d_lon;
                let nn = getOrCreateNode(newLat, newLon);
                // Usa o id do nó como chave no mapa JS
                mapN[n.getUniqueId()] = nn;
            }

            ways.forEach(function(w) {
                let nw = new Way();
                let nList = new ArrayList();
                let wn = w.getNodes();
                let valid = true;
                for (let i = 0; i < wn.size(); i++) {
                    let orig = wn.get(i);
                    if (orig === null) { valid = false; break; }
                    let mapped = mapN[orig.getUniqueId()];
                    if (mapped === undefined || mapped === null) { valid = false; break; }
                    nList.add(mapped);
                }
                if (!valid) return;
                nw.setNodes(nList);
                nw.setKeys(w.getKeys());
                cmds.add(new AddCommand(dataset, nw));
                count++;
            });
        }
    }

    if (!cmds.isEmpty()) {
        state.total_criado = count;
        state.ultimo_cmd = new SequenceCommand("Cópia Dinâmica de Grade", cmds);
        uh.add(state.ultimo_cmd);
    }
}

// --- INTERFACE ---
function mostrar_ui() {
    const dialog = new JDialog(MainApplication.getMainFrame(), "Cópia Dinâmica Unificada", false);

    let isCleanedUp = false;
    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

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

    const main_panel = new JPanel(new GridBagLayout());
    const c = new GridBagConstraints();
    c.insets = new Insets(5, 5, 5, 5);
    c.fill = GridBagConstraints.HORIZONTAL;

    // Modo
    const modo_panel = new JPanel();
    const rb_perp = new JRadioButton("Perpendicular", true);
    const rb_para = new JRadioButton("Paralelo");
    const rb_ambos = new JRadioButton("Ambos");
    const group = new ButtonGroup();
    [rb_perp, rb_para, rb_ambos].forEach(function(r) { group.add(r); modo_panel.add(r); });

    c.gridx = 0; c.gridy = 0; c.gridwidth = 2;
    main_panel.add(modo_panel, c);

    // Painel Lateral (Perpendicular)
    const p_lat = new JPanel(new GridBagLayout());
    p_lat.setBorder(BorderFactory.createTitledBorder("Função Lateral (Perpendicular)"));
    let gc = new GridBagConstraints();
    gc.insets = new Insets(2, 5, 2, 5);
    gc.fill = GridBagConstraints.HORIZONTAL;
    gc.gridx = 0; gc.gridy = 0;
    
    p_lat.add(new JLabel("Desloca Lateral:"), gc);
    const txt_p = new JTextField(state.off_p.toString(), 8);
    gc.gridx = 1; p_lat.add(txt_p, gc);
    gc.gridx = 0; gc.gridy = 1;

    p_lat.add(new JLabel("Repetições:"), gc);
    const spn_rp = new JSpinner(new SpinnerNumberModel(state.rep_p, 1, 50, 1));
    gc.gridx = 1; p_lat.add(spn_rp, gc);
    gc.gridx = 0; gc.gridy = 2;
    
    const ps_p = new JPanel();
    const btn_pm = new JButton("-");
    const btn_pp = new JButton("+");
    [btn_pm, btn_pp].forEach(function(b) { b.setPreferredSize(new Dimension(35, 25)); ps_p.add(b); });
    p_lat.add(ps_p, gc);
    
    const sp_st_p = new JSpinner(new SpinnerNumberModel(state.step_p, 0.1, 10.0, 0.1));
    sp_st_p.setBorder(BorderFactory.createTitledBorder("Passo L"));
    gc.gridx = 1; p_lat.add(sp_st_p, gc);
    c.gridy = 1; c.gridwidth = 2;
    main_panel.add(p_lat, c);

    // Painel Frontal (Paralelo)
    const p_fro = new JPanel(new GridBagLayout());
    p_fro.setBorder(BorderFactory.createTitledBorder("Função Frontal (Paralelo)"));
    gc.gridx = 0; gc.gridy = 0;
    
    p_fro.add(new JLabel("Desloca Frontal:"), gc);
    const txt_a = new JTextField(state.off_a.toString(), 8);
    gc.gridx = 1; p_fro.add(txt_a, gc);
    gc.gridx = 0; gc.gridy = 1;
    
    p_fro.add(new JLabel("Repetições:"), gc);
    const spn_ra = new JSpinner(new SpinnerNumberModel(state.rep_a, 1, 50, 1));
    gc.gridx = 1; p_fro.add(spn_ra, gc);
    gc.gridx = 0; gc.gridy = 2;

    const ps_a = new JPanel();
    const btn_am = new JButton("-");
    const btn_ap = new JButton("+");
    [btn_am, btn_ap].forEach(function(b) { b.setPreferredSize(new Dimension(35, 25)); ps_a.add(b); });
    p_fro.add(ps_a, gc);
    const sp_st_a = new JSpinner(new SpinnerNumberModel(state.step_a, 0.1, 10.0, 0.1));
    sp_st_a.setBorder(BorderFactory.createTitledBorder("Passo F"));
    gc.gridx = 1; p_fro.add(sp_st_a, gc);
    c.gridy = 2;
    main_panel.add(p_fro, c);

    // Checkbox
    const chk_mesmo_lado = new JCheckBox("Sobrepor cópias (não inverter ao negativar)", state.sobrepor_mesmo_lado);
    c.gridy = 3; c.gridwidth = 2; c.insets = new Insets(8, 5, 8, 5);
    main_panel.add(chk_mesmo_lado, c);

    // Botão Aplicar
    const btn_at = new JButton("Aplicar", ImageProvider.getIfAvailable("apply"));
    c.gridy = 4; c.insets = new Insets(5, 5, 2, 5);
    main_panel.add(btn_at, c);
    
    const lbl_hint = new JLabel("<html><div style='font-size: 10px; color: gray;'><i>* Valores negativos invertem o lado das cópias</i></div></html>");
    c.gridy = 5; c.insets = new Insets(0, 5, 10, 5);
    main_panel.add(lbl_hint, c);

    // Rodapé
    const bp = new JPanel();
    const btn_ok = new JButton("OK", UIManager.getIcon("OptionPane.yesIcon"));
    const btn_can = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
    bp.add(btn_ok); bp.add(btn_can);

    // Eventos
    const atualizar_ui = function() {
        let is_p = rb_perp.isSelected() || rb_ambos.isSelected();
        let is_a = rb_para.isSelected() || rb_ambos.isSelected();
        [txt_p, spn_rp, btn_pm, btn_pp, sp_st_p].forEach(function(comp) { comp.setEnabled(is_p); });
        [txt_a, spn_ra, btn_am, btn_ap, sp_st_a].forEach(function(comp) { comp.setEnabled(is_a); });
    };
    [rb_perp, rb_para, rb_ambos].forEach(function(r) { r.addActionListener(atualizar_ui); });
    atualizar_ui();

    const rodar = function(axis, delta) {
        try {
            state.sobrepor_mesmo_lado = chk_mesmo_lado.isSelected();
            let m = rb_perp.isSelected() ? "Perp" : (rb_para.isSelected() ? "Para" : "Ambos");

            let val_p = parseFloat(txt_p.getText()) || 0;
            let val_a = parseFloat(txt_a.getText()) || 0;

            if (axis === "p") {
                val_p += (delta * sp_st_p.getValue());
                txt_p.setText(val_p.toFixed(2));
            }
            if (axis === "a") {
                val_a += (delta * sp_st_a.getValue());
                txt_a.setText(val_a.toFixed(2));
            }

            let final_p = parseFloat(txt_p.getText()) || 0;
            let final_a = parseFloat(txt_a.getText()) || 0;

            if (isNaN(final_p) || isNaN(final_a)) {
                new Notification("Valor inválido nos campos.\nDigite um número válido.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
                return;
            }

            executar_criacao(
                m,
                final_p,
                final_a,
                spn_rp.getValue(),
                spn_ra.getValue(),
                state.sobrepor_mesmo_lado
            );

        } catch(e) {
            java.lang.System.err.println("Erro em rodar(): " + e);
            new Notification("Erro ao processar:\n" + (e.message || "Verifique os valores")).setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        }
    };

    btn_pp.addActionListener(function() { rodar("p", 1); });
    btn_pm.addActionListener(function() { rodar("p", -1); });
    btn_ap.addActionListener(function() { rodar("a", 1); });
    btn_am.addActionListener(function() { rodar("a", -1); });
    btn_at.addActionListener(function() { rodar(null, 0); });
    
    btn_ok.addActionListener(function() {
        if (state.total_criado > 0) {
            new Notification(state.total_criado + " cópia(s) criada(s) com sucesso.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
        cleanup();
    });
    
    btn_can.addActionListener(function() {
        if (state.ultimo_cmd) UndoRedoHandler.getInstance().undo();
        new Notification("Operação cancelada.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        cleanup();
    });

    dialog.addWindowListener(new WindowAdapter({
        windowClosing: function() {
            cleanup();
        }
    }));

    dialog.add(main_panel, BorderLayout.CENTER);
    dialog.add(bp, BorderLayout.SOUTH);
    dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
}

// --- START ---
try {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (layer) {
        const sel = layer.data.getSelected();
        let n = 0, w = 0;
        let it = sel.iterator();
        while(it.hasNext()){
            let item = it.next();
            if (item instanceof Node) n++;
            if (item instanceof Way) w++;
        }

        if (n >= 2 && w >= 1) {
            mostrar_ui();
        } else {
            new Notification("Selecione 2 nós de referência e ao menos um polígono.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
    } else {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
    }
} catch(e) { 
    print(e); 
}