"use strict";

// ── IMPORTS 
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const LatLon          = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeCommand   = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const DeleteCommand   = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const JDialog         = Java.type("javax.swing.JDialog");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JButton         = Java.type("javax.swing.JButton");
const JSpinner        = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const Box             = Java.type("javax.swing.Box");
const UIManager       = Java.type("javax.swing.UIManager");
const SwingUtilities  = Java.type("javax.swing.SwingUtilities");
const ImageProvider   = Java.type("org.openstreetmap.josm.tools.ImageProvider");
const FlowLayout      = Java.type("java.awt.FlowLayout");
const Font            = Java.type("java.awt.Font");
const Dimension       = Java.type("java.awt.Dimension");
const ArrayList       = Java.type("java.util.ArrayList");
const ActionListener      = Java.extend(Java.type("java.awt.event.ActionListener"));
const WindowAdapter       = Java.extend(Java.type("java.awt.event.WindowAdapter"));
const LayerChangeListener = Java.extend(
    Java.type("org.openstreetmap.josm.gui.layer.LayerManager.LayerChangeListener")
);

if (globalThis.__scriptCleanup__) {
    try { globalThis.__scriptCleanup__(); } catch(e) {}
}
if (globalThis.scriptCleanup) {
    try { globalThis.scriptCleanup(); } catch(e) {}
}

// ── VERIFICAÇÃO INICIAL 
const layer = MainApplication.getLayerManager().getEditLayer();
if (!layer || !layer.data) {
    new Notification("Nenhuma camada de edição ativa.")
        .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
} else {
    const selSet = layer.data.getSelectedNodes();
    if (selSet.size() !== 3) {
        new Notification("Selecione exatamente 3 nós.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    } else {
        const sel = [];
        const it = selSet.iterator();
        while (it.hasNext()) sel.push(it.next());
        SwingUtilities.invokeLater(function() { mostrarDialogo(sel); });
    }
}

// ── GEOMETRIA 

// Distância perpendicular de (px,py) à reta (x1,y1)→(x2,y2)
function dist_perp(px, py, x1, y1, x2, y2) {
    const num = Math.abs((x2 - x1) * (y1 - py) - (x1 - px) * (y2 - y1));
    const den = Math.hypot(x2 - x1, y2 - y1);
    return den === 0 ? 0 : num / den;
}

// Calcula os parâmetros base da elipse a partir dos 3 nós
function calcular_base(n1, n2, n3) {
    const p1 = [n1.getCoor().lon(), n1.getCoor().lat()];
    const p2 = [n2.getCoor().lon(), n2.getCoor().lat()];
    const p3 = [n3.getCoor().lon(), n3.getCoor().lat()];

    const cx    = (p1[0] + p3[0]) / 2;
    const cy    = (p1[1] + p3[1]) / 2;
    const dx    = p3[0] - p1[0];
    const dy    = p3[1] - p1[1];
    const a0    = Math.hypot(dx, dy) / 2;   // semi-eixo maior inicial
    const angle = Math.atan2(dy, dx);       // ângulo de rotação
    const b0    = dist_perp(p2[0], p2[1], p1[0], p1[1], p3[0], p3[1]); // semi-eixo menor

    return { cx, cy, angle, a0, b0 };
}

// Gera as coordenadas dos pontos da elipse
function gerar_pontos(cx, cy, angle, a, b, num_pontos) {
    const pts = [];
    for (let i = 0; i < num_pontos; i++) {
        const t  = 2 * Math.PI * i / num_pontos;
        const ex = a * Math.cos(t);
        const ey = b * Math.sin(t);
        const rx = ex * Math.cos(angle) - ey * Math.sin(angle);
        const ry = ex * Math.sin(angle) + ey * Math.cos(angle);
        pts.push([cx + rx, cy + ry]);
    }
    return pts;
}

// ── DIÁLOGO 
function mostrarDialogo(sel) {
    const ds    = layer.data;
    const n1    = sel[0], n2 = sel[1], n3 = sel[2];
    const base  = calcular_base(n1, n2, n3);

    // Estado mutável da elipse
    let a        = base.a0;
    let b        = base.b0;
    const passo  = 0.000005; // ~0.5m em graus de lon/lat — ajuste fino

    // Nós e way de preview (criados antes de abrir o diálogo)
    let preview_nodes = [];
    let preview_way   = null;
    let preview_criado = false;

    // ── Cria preview inicial 
    function criar_preview() {
        const pts  = gerar_pontos(base.cx, base.cy, base.angle, a, b, 30);
        const cmds = new ArrayList();

        preview_nodes = pts.map(function(p) {
            const nn = new Node(new LatLon(p[1], p[0]));
            cmds.add(new AddCommand(ds, nn));
            return nn;
        });

        preview_way = new Way();
        preview_nodes.forEach(function(n) { preview_way.addNode(n); });
        preview_way.addNode(preview_nodes[0]); // fecha
        cmds.add(new AddCommand(ds, preview_way));

        UndoRedoHandler.getInstance().add(new SequenceCommand("Preview elipse", cmds));
        ds.setSelected(preview_way);
        layer.invalidate();
        preview_criado = true;
    }

    // ── Atualiza preview movendo os nós existentes (sem novo histórico) 
    function atualizar_preview() {
        const pts = gerar_pontos(base.cx, base.cy, base.angle, a, b,
                                  preview_nodes.length);
        for (let i = 0; i < preview_nodes.length; i++) {
            preview_nodes[i].setCoor(new LatLon(pts[i][1], pts[i][0]));
        }
        layer.invalidate();
        MainApplication.getMap().mapView.repaint();
    }

    // ── Confirma no histórico (padrão aprendido) 
    function confirmar_no_historico() {
        const pts  = gerar_pontos(base.cx, base.cy, base.angle, a, b,
                                   preview_nodes.length);
        const cmds = new ArrayList();

        for (let i = 0; i < preview_nodes.length; i++) {
            const n_after = new Node(preview_nodes[i]);
            n_after.setCoor(new LatLon(pts[i][1], pts[i][0]));
            preview_nodes[i].setCoor(preview_nodes[i].getCoor()); // garante before
            cmds.add(new ChangeCommand(preview_nodes[i], n_after));
        }

        // Remove os 3 nós de referência e eventuais triângulos auxiliares
        const ways_ds = ds.getWays();
        const it = ways_ds.iterator();
        while (it.hasNext()) {
            const w = it.next();
            const wn = w.getNodes();
            if (wn.size() === 3 &&
                wn.contains(n1) && wn.contains(n2) && wn.contains(n3)) {
                cmds.add(new DeleteCommand(ds, w));
            }
        }
        cmds.add(new DeleteCommand(ds, n1));
        cmds.add(new DeleteCommand(ds, n2));
        cmds.add(new DeleteCommand(ds, n3));

        UndoRedoHandler.getInstance().add(new SequenceCommand("Elipse final", cmds));
        layer.invalidate();
    }

    // ── Desfaz preview (Cancelar) 
    function desfazer_preview() {
        if (preview_criado) {
            // Sempre apenas 1 undo — o spinner não usa histórico (ver abaixo)
            UndoRedoHandler.getInstance().undo(); // desfaz "Preview elipse"
            layer.invalidate();
        }
    }

    // ── UI 
    const main_panel = new JPanel();
    main_panel.setLayout(new BoxLayout(main_panel, 1)); // Y_AXIS
    main_panel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

    // Info
    const lbl_info = new JLabel(
        "<html><b>a</b> = semi-eixo maior &nbsp;|&nbsp; <b>b</b> = semi-eixo menor</html>"
    );
    lbl_info.setFont(new Font("Dialog", 0, 11));
    lbl_info.setAlignmentX(0.0);
    main_panel.add(lbl_info);
    main_panel.add(Box.createVerticalStrut(6));

    // ── Spinner de pontos 
    const sp_panel = new JPanel(new FlowLayout(0, 6, 2));
    sp_panel.setBorder(BorderFactory.createTitledBorder("Resolução"));
    sp_panel.setAlignmentX(0.0);
    sp_panel.add(new JLabel("Pontos:"));
    const spinner = new JSpinner(new SpinnerNumberModel(30, 12, 360, 5));
    sp_panel.add(spinner);
    main_panel.add(sp_panel);
    main_panel.add(Box.createVerticalStrut(4));

    // ── Controles de forma 
    function criar_linha_controle(titulo, label_neg, label_pos, acao_neg, acao_pos) {
        const p = new JPanel(new FlowLayout(2, 4, 2)); // CENTER
        p.setBorder(BorderFactory.createTitledBorder(titulo));
        p.setAlignmentX(0.0);

        const btn_neg = new JButton(label_neg);
        const btn_pos = new JButton(label_pos);
        const dim = new Dimension(90, 26);
        btn_neg.setPreferredSize(dim);
        btn_pos.setPreferredSize(dim);

        btn_neg.addActionListener(new ActionListener({ actionPerformed: function() {
            acao_neg(); atualizar_preview();
        }}));
        btn_pos.addActionListener(new ActionListener({ actionPerformed: function() {
            acao_pos(); atualizar_preview();
        }}));

        p.add(btn_neg);
        p.add(btn_pos);
        return p;
    }

    // Eixo A — Alongar / Encurtar
    main_panel.add(criar_linha_controle(
        "Eixo A (comprimento)",
        "▼  Encurtar",
        "Alongar ▲",
        function() { a = Math.max(passo, a - passo * 5); },
        function() { a += passo * 5; }
    ));
    main_panel.add(Box.createVerticalStrut(2));

    // Eixo B — Engordar / Estreitar
    main_panel.add(criar_linha_controle(
        "Eixo B (largura)",
        "◀ Estreitar",
        "Alargar ▶",
        function() { b = Math.max(passo, b - passo * 5); },
        function() { b += passo * 5; }
    ));
    main_panel.add(Box.createVerticalStrut(6));

    // ── Botões OK / Cancelar 
    const btn_panel = new JPanel(new FlowLayout(2, 8, 6));
    btn_panel.setAlignmentX(0.0);
    const btn_ok  = new JButton("OK",       UIManager.getIcon("OptionPane.yesIcon"));
    const btn_can = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
    btn_panel.add(btn_ok);
    btn_panel.add(btn_can);
    main_panel.add(btn_panel);

    // ── Diálogo 
    const dialog = new JDialog(MainApplication.getMainFrame(), "Criar Elipse", false);
    dialog.setContentPane(main_panel);
    dialog.setDefaultCloseOperation(2);
    dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());

    // Spinner de pontos — ao mudar resolução, desfaz o preview atual e recria.
    // Assim desfazer_preview() continua precisando de apenas 1 undo().
    const ChangeListener = Java.extend(Java.type("javax.swing.event.ChangeListener"));
    spinner.addChangeListener(new ChangeListener({ stateChanged: function() {
        if (!preview_criado) return;
        const nova_qtd = spinner.getValue();
        if (nova_qtd === preview_nodes.length) return;

        // Desfaz o preview atual (1 undo) e recria com nova resolução
        UndoRedoHandler.getInstance().undo();
        preview_criado = false;
        preview_nodes  = [];
        preview_way    = null;

        const pts  = gerar_pontos(base.cx, base.cy, base.angle, a, b, nova_qtd);
        const cmds = new ArrayList();

        preview_nodes = pts.map(function(p) {
            const nn = new Node(new LatLon(p[1], p[0]));
            cmds.add(new AddCommand(ds, nn));
            return nn;
        });
        preview_way = new Way();
        preview_nodes.forEach(function(n) { preview_way.addNode(n); });
        preview_way.addNode(preview_nodes[0]);
        cmds.add(new AddCommand(ds, preview_way));

        UndoRedoHandler.getInstance().add(new SequenceCommand("Preview elipse", cmds));
        ds.setSelected(preview_way);
        preview_criado = true;
        layer.invalidate();
        MainApplication.getMap().mapView.repaint();
    }}));

    let isCleanedUp = false;
    let windowAdapter = null;

    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        desfazer_preview();

        if (layerListener) {
            try { MainApplication.getLayerManager().removeLayerChangeListener(layerListener); } catch(e) {}
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

    // ── Layer listener 
    const layerListener = new LayerChangeListener({
        layerAdded:        function(e) {},
        layerOrderChanged: function(e) {},
        layerRemoving:     function(e) {
            if (e.getRemovedLayer() === layer) {
                SwingUtilities.invokeLater(function() {
                    cleanup();
                    new Notification("Camada removida. Fechando diálogo.")
                        .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                });
            }
        }
    });
    MainApplication.getLayerManager().addLayerChangeListener(layerListener);

    // ── Listeners botões 
    btn_ok.addActionListener(new ActionListener({ actionPerformed: function() {
        preview_criado = false;
        cleanup();
        confirmar_no_historico();
        new Notification("Elipse criada com sucesso.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    }}));

    btn_can.addActionListener(new ActionListener({ actionPerformed: function() {
        cleanup();
        new Notification("Operação cancelada.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    }}));

    windowAdapter = new WindowAdapter({ windowClosing: function() {
        cleanup();
    }});
    dialog.addWindowListener(windowAdapter);

    // Cria preview e abre diálogo
    criar_preview();
    dialog.setVisible(true);
}
