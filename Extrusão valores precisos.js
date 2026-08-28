"use strict";

// --- IMPORTS JAVA ---
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeCommand   = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const LatLon          = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");

const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JDialog         = Java.type("javax.swing.JDialog");
const JButton         = Java.type("javax.swing.JButton");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const JSpinner        = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const UIManager       = Java.type("javax.swing.UIManager");
const JRadioButton    = Java.type("javax.swing.JRadioButton");
const ButtonGroup     = Java.type("javax.swing.ButtonGroup");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const Component       = Java.type("java.awt.Component");
const FlowLayout      = Java.type("java.awt.FlowLayout");
const ArrayList       = Java.type("java.util.ArrayList");
const JOptionPane     = Java.type("javax.swing.JOptionPane");
const ImageProvider   = Java.type("org.openstreetmap.josm.tools.ImageProvider");
const WindowAdapter   = Java.extend(Java.type("java.awt.event.WindowAdapter"));

// --- FUNÇÕES AUXILIARES ---

function resolver_selecao(cur_nodes, cur_ways) {
    if (cur_nodes.length !== 2) return null;
    const n1 = cur_nodes[0], n2 = cur_nodes[1];

    if (cur_ways.length === 1) return { way: cur_ways[0], n1, n2 };

    const ways_n1 = n1.getParentWays();
    const ways_n2 = n2.getParentWays();
    const comuns = [];
    const it = ways_n1.iterator();
    while (it.hasNext()) {
        const w = it.next();
        if (ways_n2.contains(w)) comuns.push(w);
    }

    if (comuns.length === 1) return { way: comuns[0], n1, n2 };
    return null;
}

function eh_90_graus(n_prev, n_curr, n_next, m_lat, m_lon) {
    if (!n_prev || !n_next) return false;
    const c1 = n_prev.getCoor(), c2 = n_curr.getCoor(), c3 = n_next.getCoor();
    const v1x = (c1.lon() - c2.lon()) * m_lon, v1y = (c1.lat() - c2.lat()) * m_lat;
    const v2x = (c3.lon() - c2.lon()) * m_lon, v2y = (c3.lat() - c2.lat()) * m_lat;
    const dot = v1x * v2x + v1y * v2y;
    const mag = Math.sqrt(v1x * v1x + v1y * v1y) * Math.sqrt(v2x * v2x + v2y * v2y);
    if (mag === 0) return false;
    return Math.abs(dot / mag) < 0.15;
}

// --- FUNÇÃO PRINCIPAL ---

function extrusao_precisa() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    const ds = layer.data;

    // ── INTERFACE 
    const main_panel = new JPanel();
    main_panel.setLayout(new BoxLayout(main_panel, 1)); // Y_AXIS = 1
    main_panel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

    // Painel: Distância
    const dist_panel = new JPanel(new FlowLayout(0, 6, 2));
    dist_panel.setBorder(BorderFactory.createTitledBorder("Medida"));
    dist_panel.setAlignmentX(Component.LEFT_ALIGNMENT);
    dist_panel.add(new JLabel("Distância (m):"));
    const spinner = new JSpinner(new SpinnerNumberModel(1.0, 0.01, 500.0, 0.5));
    dist_panel.add(spinner);
    main_panel.add(dist_panel);

    // Painel: Direção
    const dir_panel = new JPanel(new FlowLayout(0, 6, 2));
    dir_panel.setBorder(BorderFactory.createTitledBorder("Direção"));
    dir_panel.setAlignmentX(Component.LEFT_ALIGNMENT);
    const rb_fora   = new JRadioButton("Para Fora", true);
    const rb_dentro = new JRadioButton("Para Dentro", false);
    const bg_dir = new ButtonGroup();
    bg_dir.add(rb_fora); bg_dir.add(rb_dentro);
    dir_panel.add(rb_fora);
    dir_panel.add(rb_dentro);
    main_panel.add(dir_panel);

    // Painel: Modo
    const modo_panel = new JPanel(new FlowLayout(0, 6, 2));
    modo_panel.setBorder(BorderFactory.createTitledBorder("Método de Construção"));
    modo_panel.setAlignmentX(Component.LEFT_ALIGNMENT);
    const rb_novo    = new JRadioButton("Novo Polígono", true);
    const rb_mesclar = new JRadioButton("Mesclar à Área", false);
    const bg_modo = new ButtonGroup();
    bg_modo.add(rb_novo); bg_modo.add(rb_mesclar);
    modo_panel.add(rb_novo);
    modo_panel.add(rb_mesclar);
    main_panel.add(modo_panel);

    // Aviso informativo
    const lbl_info = new JLabel(
        "<html><div style='color:#ffff00; padding:2px 0;'>" +
        "Se os nós não forem consecutivos;<br>" +
        "Modo mesclar irá distorcer o polígono</div></html>"
    );
    lbl_info.setAlignmentX(Component.LEFT_ALIGNMENT);
    lbl_info.setBorder(BorderFactory.createEmptyBorder(4, 4, 2, 4));
    main_panel.add(lbl_info);

    // Botão Aplicar
    const btn_at_panel = new JPanel(new FlowLayout(2, 8, 4)); // CENTER = 2
    btn_at_panel.setAlignmentX(Component.LEFT_ALIGNMENT);
    const btn_at = new JButton("Aplicar", ImageProvider.getIfAvailable("apply"));
    btn_at_panel.add(btn_at);
    main_panel.add(btn_at_panel);

    // Botões OK / Cancelar
    const btn_panel = new JPanel(new FlowLayout(2, 8, 4));
    btn_panel.setAlignmentX(Component.LEFT_ALIGNMENT);
    const btn_ok  = new JButton("OK",       UIManager.getIcon("OptionPane.yesIcon"));
    const btn_can = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
    btn_panel.add(btn_ok);
    btn_panel.add(btn_can);
    main_panel.add(btn_panel);

    // Diálogo não-modal
    const dialog = new JDialog(MainApplication.getMainFrame(), "Extrusão Precisa", false);
    dialog.setContentPane(main_panel);
    dialog.setDefaultCloseOperation(2); // DISPOSE_ON_CLOSE
    dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());

    let total_extrusoes = 0;

    // ── LÓGICA DE EXTRUSÃO 
    function executar_extrusao() {
        const sel = ds.getSelected();
        const cur_nodes = [], cur_ways = [];
        const it = sel.iterator();
        while (it.hasNext()) {
            const o = it.next();
            if (o instanceof Node) cur_nodes.push(o);
            else if (o instanceof Way) cur_ways.push(o);
        }

        const res = resolver_selecao(cur_nodes, cur_ways);
        if (!res) {
            new Notification("Selecione 2 nós consecutivos (e opcionalmente a via).")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            return false;
        }

        const { way, n1, n2 } = res;

        // Validação: se uma via foi explicitamente selecionada, os nós devem pertencer a ela
        if (cur_ways.length === 1) {
            const via_nodes = [];
            for (let i = 0; i < way.getNodesCount(); i++) via_nodes.push(way.getNode(i));
            if (via_nodes.indexOf(n1) === -1 || via_nodes.indexOf(n2) === -1) {
                new Notification("Os nós selecionados não pertencem à via selecionada.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                return false;
            }
        }

        const nodes_way = [];
        for (let i = 0; i < way.getNodesCount(); i++) nodes_way.push(way.getNode(i));

        // Detecta nós compartilhados (pertencem a mais de uma via)
        // Usado apenas no modo mesclar (ver abaixo)
        const n1_compartilhado = n1.getParentWays().size() > 1;
        const n2_compartilhado = n2.getParentWays().size() > 1;

        const c1 = n1.getCoor(), c2 = n2.getCoor();
        const m_lat = 111319.492;
        const m_lon = m_lat * Math.cos((Math.PI / 180) * c1.lat());

        const dx = (c2.lon() - c1.lon()) * m_lon, dy = (c2.lat() - c1.lat()) * m_lat;
        const comp = Math.hypot(dx, dy);
        if (comp === 0) return false;

        let nx = -dy / comp, ny = dx / comp;

        const clon = nodes_way.reduce((a, b) => a + b.getCoor().lon(), 0) / nodes_way.length;
        const clat = nodes_way.reduce((a, b) => a + b.getCoor().lat(), 0) / nodes_way.length;
        const is_out = ((c1.lon() + c2.lon()) / 2 - clon) * nx + ((c1.lat() + c2.lat()) / 2 - clat) * ny >= 0;
        if ((rb_fora.isSelected() && !is_out) || (rb_dentro.isSelected() && is_out)) { nx = -nx; ny = -ny; }

        const dist = spinner.getValue();
        const off_lat = (ny * dist) / m_lat, off_lon = (nx * dist) / m_lon;

        const comandos = new ArrayList();

        if (rb_mesclar.isSelected()) {
            // Ambos compartilhados: impossível extrudar sem deformar outras vias
            if (n1_compartilhado && n2_compartilhado) {
                new Notification("Ambos os nós são compartilhados. Extrusão apenas no modo Novo Polígono.")
                    .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
                return false;
            }

            const idx1 = nodes_way.indexOf(n1), idx2 = nodes_way.indexOf(n2);
            const getPrev = (i) => nodes_way[i === 0 ? nodes_way.length - 2 : i - 1];
            const getNext = (i) => nodes_way[i === nodes_way.length - 1 ? 1 : i + 1];

            const n1_90 = eh_90_graus(getPrev(idx1), n1, getNext(idx1), m_lat, m_lon);
            const n2_90 = eh_90_graus(getPrev(idx2), n2, getNext(idx2), m_lat, m_lon);

            // Nó compartilhado SEMPRE gera novo nó (nunca move o original)
            // para não arrastar geometria de outras vias.
            // Nó livre: segue lógica híbrida (90° → move, intermediário → cria novo)
            let t1, t2;

            if (!n1_compartilhado && n1_90) {
                // Vértice livre: move o nó existente
                t1 = new Node(n1);
                t1.setCoor(new LatLon(n1.getCoor().lat() + off_lat, n1.getCoor().lon() + off_lon));
                comandos.add(new ChangeCommand(n1, t1));
            } else {
                // Compartilhado ou intermediário: cria novo nó
                t1 = new Node(new LatLon(n1.getCoor().lat() + off_lat, n1.getCoor().lon() + off_lon));
                comandos.add(new AddCommand(ds, t1));
            }

            if (!n2_compartilhado && n2_90) {
                // Vértice livre: move o nó existente
                t2 = new Node(n2);
                t2.setCoor(new LatLon(n2.getCoor().lat() + off_lat, n2.getCoor().lon() + off_lon));
                comandos.add(new ChangeCommand(n2, t2));
            } else {
                // Compartilhado ou intermediário: cria novo nó
                t2 = new Node(new LatLon(n2.getCoor().lat() + off_lat, n2.getCoor().lon() + off_lon));
                comandos.add(new AddCommand(ds, t2));
            }

            // Precisa inserir nós no way se algum gerou AddCommand (novo nó)
            const n1_gerou_novo = n1_compartilhado || !n1_90;
            const n2_gerou_novo = n2_compartilhado || !n2_90;

            if (n1_gerou_novo || n2_gerou_novo) {
                const newWay = new Way(way);
                const newList = new ArrayList();
                for (let i = 0; i < nodes_way.length; i++) {
                    const curr = nodes_way[i];
                    newList.add(curr);
                    if (curr === n1 && nodes_way[i + 1] === n2) {
                        if (n1_gerou_novo) newList.add(t1);
                        if (n2_gerou_novo) newList.add(t2);
                    } else if (curr === n2 && nodes_way[i + 1] === n1) {
                        if (n2_gerou_novo) newList.add(t2);
                        if (n1_gerou_novo) newList.add(t1);
                    }
                }
                if (way.isClosed()) newList.set(newList.size() - 1, newList.get(0));
                newWay.setNodes(newList);
                comandos.add(new ChangeCommand(way, newWay));
            }
        } else {
            const nv1 = new Node(new LatLon(c1.lat() + off_lat, c1.lon() + off_lon));
            const nv2 = new Node(new LatLon(c2.lat() + off_lat, c2.lon() + off_lon));
            comandos.add(new AddCommand(ds, nv1));
            comandos.add(new AddCommand(ds, nv2));
            const w1 = new Way();
            const rect_nodes = new ArrayList();
            [n1, n2, nv2, nv1, n1].forEach(n => rect_nodes.add(n));
            w1.setNodes(rect_nodes);
            w1.setKeys(way.getKeys());
            comandos.add(new AddCommand(ds, w1));
        }

        UndoRedoHandler.getInstance().add(new SequenceCommand("Extrusão Precisa", comandos));
        layer.invalidate();
        total_extrusoes++;
        return true;
    }

    // ── CLEANUP E HOOKS

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

    // ── LISTENERS

    // Aplicar: executa sem fechar
    btn_at.addActionListener(function(_e) {
        executar_extrusao();
    });

    // OK: apenas fecha e notifica
    btn_ok.addActionListener(function(_e) {
        cleanup();
        if (total_extrusoes > 0) {
            new Notification("Extrusão concluída. Total aplicado: " + total_extrusoes + "×")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Nenhuma extrusão foi aplicada.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
    });

    // Cancelar: desfaz todas as extrusões da sessão e fecha
    btn_can.addActionListener(function(_e) {
        cleanup();
        if (total_extrusoes > 0) {
            for (let i = 0; i < total_extrusoes; i++) UndoRedoHandler.getInstance().undo();
            layer.invalidate();
        }
        new Notification("Operação cancelada. " + total_extrusoes + " extrusão(ões) desfeita(s).")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    });

    dialog.addWindowListener(new WindowAdapter({
        windowClosing: function(_e) {
            cleanup();
        }
    }));

    dialog.setVisible(true);
}

extrusao_precisa();