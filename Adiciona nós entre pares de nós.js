"use strict";

// ── IMPORTS 
const MainApplication    = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification       = Java.type("org.openstreetmap.josm.gui.Notification");
const Node               = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way                = Java.type("org.openstreetmap.josm.data.osm.Way");
const OsmDataLayer       = Java.type("org.openstreetmap.josm.gui.layer.OsmDataLayer");
const SequenceCommand    = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const AddCommand         = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeNodesCommand = Java.type("org.openstreetmap.josm.command.ChangeNodesCommand");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const EastNorth          = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const UndoRedoHandler    = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const JDialog            = Java.type("javax.swing.JDialog");
const JPanel             = Java.type("javax.swing.JPanel");
const JLabel             = Java.type("javax.swing.JLabel");
const JButton            = Java.type("javax.swing.JButton");
const JSpinner           = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const BorderFactory      = Java.type("javax.swing.BorderFactory");
const BoxLayout          = Java.type("javax.swing.BoxLayout");
const Box                = Java.type("javax.swing.Box");
const UIManager          = Java.type("javax.swing.UIManager");
const SwingUtilities     = Java.type("javax.swing.SwingUtilities");
const ImageProvider      = Java.type("org.openstreetmap.josm.tools.ImageProvider");
const FlowLayout         = Java.type("java.awt.FlowLayout");
const Font               = Java.type("java.awt.Font");
const ArrayList          = Java.type("java.util.ArrayList");
const ActionListener      = Java.extend(Java.type("java.awt.event.ActionListener"));
const WindowAdapter       = Java.extend(Java.type("java.awt.event.WindowAdapter"));
const LayerChangeListener = Java.extend(
    Java.type("org.openstreetmap.josm.gui.layer.LayerManager.LayerChangeListener")
);

// ── VERIFICAÇÃO INICIAL 
const layer = MainApplication.getLayerManager().getEditLayer();
if (!layer || !layer.data) {
    new Notification("Nenhuma camada de edição ativa.")
        .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
} else {
    SwingUtilities.invokeLater(function() { mostrarDialogo(); });
}

// ── DIÁLOGO 
function mostrarDialogo() {
    const ds = layer.data;
    let total_aplicados = 0; // total de nós inseridos na sessão
    let total_cmds      = 0; // total de SequenceCommands (um por Aplicar)

    // Painel principal
    const main_panel = new JPanel();
    main_panel.setLayout(new BoxLayout(main_panel, 1)); // Y_AXIS = 1
    main_panel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

    // ── Painel de status 
    const info_panel = new JPanel();
    info_panel.setLayout(new BoxLayout(info_panel, 1));
    info_panel.setBorder(BorderFactory.createCompoundBorder(
        BorderFactory.createTitledBorder("Seleção atual"),
        BorderFactory.createEmptyBorder(2, 4, 4, 4)
    ));
    info_panel.setAlignmentX(0.0);

    const lbl_modo      = new JLabel("Modo: —");
    const lbl_segmentos = new JLabel("Segmentos: —");
    const lbl_nos_via   = new JLabel("Nós na via: —");
    const lbl_aplicados = new JLabel("Nós adicionados: 0");

    lbl_modo.setFont(new Font("Dialog", 0, 12));      // PLAIN = 0
    lbl_segmentos.setFont(new Font("Dialog", 0, 12));
    lbl_nos_via.setFont(new Font("Dialog", 0, 12));
    lbl_aplicados.setFont(new Font("Dialog", 1, 12)); // BOLD = 1

    info_panel.add(lbl_modo);
    info_panel.add(lbl_segmentos);
    info_panel.add(lbl_nos_via);
    info_panel.add(Box.createVerticalStrut(3));
    info_panel.add(lbl_aplicados);
    main_panel.add(info_panel);
    main_panel.add(Box.createVerticalStrut(6));

    // ── Spinner 
    const spinner_panel = new JPanel(new FlowLayout(0, 6, 2)); // LEFT = 0
    spinner_panel.setBorder(BorderFactory.createTitledBorder("Nós por segmento"));
    spinner_panel.setAlignmentX(0.0);
    spinner_panel.add(new JLabel("Quantidade:"));
    const spinner = new JSpinner(new SpinnerNumberModel(1, 1, 100, 1));
    spinner_panel.add(spinner);
    main_panel.add(spinner_panel);
    main_panel.add(Box.createVerticalStrut(6));

    // ── Botão Aplicar (linha própria) 
    const btn_ap_panel = new JPanel(new FlowLayout(2, 8, 2)); // CENTER = 2
    btn_ap_panel.setAlignmentX(0.0);
    const btn_aplicar = new JButton("Aplicar", ImageProvider.getIfAvailable("apply"));
    btn_ap_panel.add(btn_aplicar);
    main_panel.add(btn_ap_panel);

    // ── Botões OK / Cancelar 
    const btn_panel = new JPanel(new FlowLayout(2, 8, 4));
    btn_panel.setAlignmentX(0.0);
    const btn_ok  = new JButton("OK",       UIManager.getIcon("OptionPane.yesIcon"));
    const btn_can = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
    btn_panel.add(btn_ok);
    btn_panel.add(btn_can);
    main_panel.add(btn_panel);

    // ── Diálogo
    const dialog = new JDialog(MainApplication.getMainFrame(), "Adicionar Nós", false);
    dialog.setContentPane(main_panel);
    dialog.setDefaultCloseOperation(2); // DISPOSE_ON_CLOSE
    dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());

    // ── Atualiza labels de status 
    function atualizar_status() {
        const sel = ds.getSelected();
        const ways = [], nodes = [];
        const it = sel.iterator();
        while (it.hasNext()) {
            const o = it.next();
            if (o instanceof Way) ways.push(o);
            else if (o instanceof Node) nodes.push(o);
        }

        function aplicar_info(way, seg, modo) {
            let wn = [];
            for (let i = 0; i < way.getNodesCount(); i++) wn.push(way.getNode(i));
            const ic = way.isClosed();
            if (ic && wn[0] === wn[wn.length - 1]) wn.pop();
            lbl_modo.setText("Modo: " + modo);
            lbl_segmentos.setText("Segmentos: " + seg);
            lbl_nos_via.setText("Nós na via: " + wn.length);
        }

        if (ways.length === 0 && nodes.length === 0) {
            lbl_modo.setText("Modo: nenhuma seleção");
            lbl_segmentos.setText("Segmentos: —");
            lbl_nos_via.setText("Nós na via: —");
            dialog.pack(); return;
        }

        if (ways.length === 1) {
            const way = ways[0];
            let wn = [];
            for (let i = 0; i < way.getNodesCount(); i++) wn.push(way.getNode(i));
            const ic = way.isClosed();
            if (ic && wn[0] === wn[wn.length - 1]) wn.pop();
            const total_seg = ic ? wn.length : wn.length - 1;

            if (nodes.length === 0) {
                aplicar_info(way, total_seg, "toda a via");
            } else if (nodes.length === 2) {
                const p1 = wn.indexOf(nodes[0]) !== -1;
                const p2 = wn.indexOf(nodes[1]) !== -1;
                if (p1 && p2) {
                    const i1 = wn.indexOf(nodes[0]), i2 = wn.indexOf(nodes[1]);
                    const tot = wn.length;
                    let c1 = 0, idx = i1;
                    while (idx !== i2) { c1++; idx = (idx + 1) % tot; }
                    const seg_t = ic ? Math.min(c1, tot - c1) : Math.abs(i2 - i1);
                    aplicar_info(way, seg_t, "trecho (2 nós)");
                } else {
                    lbl_modo.setText("Modo: nós fora da via");
                    lbl_segmentos.setText("Segmentos: —");
                    lbl_nos_via.setText("Nós na via: —");
                }
            } else {
                lbl_modo.setText("Modo: inválido (" + nodes.length + " nós)");
                lbl_segmentos.setText("Segmentos: —");
                lbl_nos_via.setText("Nós na via: —");
            }
        } else if (ways.length === 0 && nodes.length === 2) {
            // tenta identificar via pelos 2 nós
            const pw1 = nodes[0].getParentWays(), pw2 = nodes[1].getParentWays();
            const comuns = [];
            const it2 = pw1.iterator();
            while (it2.hasNext()) { const w = it2.next(); if (pw2.contains(w)) comuns.push(w); }
            if (comuns.length === 1) {
                const way = comuns[0];
                let wn = [];
                for (let i = 0; i < way.getNodesCount(); i++) wn.push(way.getNode(i));
                const ic = way.isClosed();
                if (ic && wn[0] === wn[wn.length - 1]) wn.pop();
                const i1 = wn.indexOf(nodes[0]), i2 = wn.indexOf(nodes[1]);
                const tot = wn.length;
                let c1 = 0, idx = i1;
                while (idx !== i2) { c1++; idx = (idx + 1) % tot; }
                const seg_t = ic ? Math.min(c1, tot - c1) : Math.abs(i2 - i1);
                lbl_modo.setText("Modo: trecho (via identificada)");
                lbl_segmentos.setText("Segmentos: " + seg_t);
                lbl_nos_via.setText("Nós na via: " + wn.length);
            } else if (comuns.length === 0) {
                lbl_modo.setText("Modo: nós sem via comum");
                lbl_segmentos.setText("Segmentos: —");
                lbl_nos_via.setText("Nós na via: —");
            } else {
                lbl_modo.setText("Modo: ambíguo (" + comuns.length + " vias)");
                lbl_segmentos.setText("Segmentos: —");
                lbl_nos_via.setText("Nós na via: —");
            }
        } else {
            lbl_modo.setText("Modo: seleção inválida");
            lbl_segmentos.setText("Segmentos: —");
            lbl_nos_via.setText("Nós na via: —");
        }

        dialog.pack();
    }

    // ── Lógica de inserção 
    function executar() {
        const sel = ds.getSelected();
        const sel_ways = [], sel_nodes = [];
        const it = sel.iterator();
        while (it.hasNext()) {
            const o = it.next();
            if (o instanceof Way) sel_ways.push(o);
            else if (o instanceof Node) sel_nodes.push(o);
        }

        let way = null;
        if (sel_ways.length === 1) {
            way = sel_ways[0];
        } else if (sel_ways.length === 0 && sel_nodes.length === 2) {
            const pw1 = sel_nodes[0].getParentWays(), pw2 = sel_nodes[1].getParentWays();
            const comuns = [];
            const it2 = pw1.iterator();
            while (it2.hasNext()) { const w = it2.next(); if (pw2.contains(w)) comuns.push(w); }
            if (comuns.length === 1) way = comuns[0];
        }

        if (!way) {
            new Notification("Selecione 1 via (e opcionalmente 2 nós dela).")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            return;
        }
        if (sel_nodes.length !== 0 && sel_nodes.length !== 2) {
            new Notification("Selecione 0 ou exatamente 2 nós da via.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            return;
        }

        let way_nodes = [];
        for (let i = 0; i < way.getNodesCount(); i++) way_nodes.push(way.getNode(i));
        const is_closed = way.isClosed();
        if (is_closed && way_nodes[0] === way_nodes[way_nodes.length - 1]) way_nodes.pop();

        let modo_trecho = false;
        if (sel_nodes.length === 2) {
            if (!sel_nodes.every(n => way_nodes.indexOf(n) !== -1)) {
                new Notification("Os 2 nós selecionados devem pertencer à via.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                return;
            }
            modo_trecho = true;
        }

        const num_nodes  = spinner.getValue();
        const projection = ProjectionRegistry.getProjection();
        const commands   = new ArrayList();
        const upd        = [];
        let nos_inseridos = 0;

        function interpolar(n_start, n_end) {
            const es = n_start.getEastNorth(), ee = n_end.getEastNorth();
            const dx = (ee.east()  - es.east())  / (num_nodes + 1);
            const dy = (ee.north() - es.north()) / (num_nodes + 1);
            for (let j = 1; j <= num_nodes; j++) {
                const nn = new Node(projection.eastNorth2latlon(
                    new EastNorth(es.east() + dx * j, es.north() + dy * j)));
                nn.setModified(true);
                commands.add(new AddCommand(ds, nn));
                upd.push(nn);
                nos_inseridos++;
            }
        }

        if (modo_trecho) {
            const n1 = sel_nodes[0], n2 = sel_nodes[1];
            let i1 = way_nodes.indexOf(n1), i2 = way_nodes.indexOf(n2);
            if (i1 === i2) {
                new Notification("Os nós não formam um trecho válido.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                return;
            }
            const total = way_nodes.length;
            let c1 = [], idx = i1;
            while (idx !== i2) { c1.push(idx); idx = (idx + 1) % total; }
            let c2 = []; idx = i2;
            while (idx !== i1) { c2.push(idx); idx = (idx + 1) % total; }

            let indices_validos;
            if (is_closed) {
                indices_validos = (c1.length <= c2.length) ? c1 : c2;
            } else {
                if (i1 > i2) { let t = i1; i1 = i2; i2 = t; }
                indices_validos = Array.from({length: i2 - i1}, (_, i) => i + i1);
            }

            for (let i = 0; i < way_nodes.length; i++) {
                upd.push(way_nodes[i]);
                if (indices_validos.indexOf(i) !== -1)
                    interpolar(way_nodes[i], way_nodes[(i + 1) % way_nodes.length]);
            }
        } else {
            for (let i = 0; i < (way_nodes.length - (is_closed ? 0 : 1)); i++) {
                upd.push(way_nodes[i]);
                const ne = is_closed ? way_nodes[(i + 1) % way_nodes.length] : way_nodes[i + 1];
                interpolar(way_nodes[i], ne);
            }
            if (!is_closed) upd.push(way_nodes[way_nodes.length - 1]);
        }

        if (is_closed && upd[0] !== upd[upd.length - 1]) upd.push(upd[0]);

        const javaList = new ArrayList();
        upd.forEach(n => javaList.add(n));
        commands.add(new ChangeNodesCommand(way, javaList));
        UndoRedoHandler.getInstance().add(new SequenceCommand("Inserir nós", commands));
        layer.invalidate();

        total_aplicados += nos_inseridos;
        total_cmds++;
        lbl_aplicados.setText("Nós adicionados: " + total_aplicados);
        atualizar_status(); // atualiza segmentos/nós com novo estado da via
    }

    // ── Cleanup
    let isCleanedUp = false;
    let windowAdapter = null;

    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (layerListener) {
            try { MainApplication.getLayerManager().removeLayerChangeListener(layerListener); } catch(e) {}
        }
        if (windowAdapter) {
            try { dialog.removeWindowListener(windowAdapter); } catch(e) {}
        }
        dialog.dispose();
    };

    if (typeof __josmContextResetHooks__ !== 'undefined') {
        __josmContextResetHooks__.register(cleanup);
    }

    if (globalThis.__scriptCleanup__) {
        try { globalThis.__scriptCleanup__(); } catch(e) {}
    }
    globalThis.__scriptCleanup__ = cleanup;

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

    // ── Listeners dos botões 
    btn_aplicar.addActionListener(new ActionListener({
        actionPerformed: function() { executar(); }
    }));

    // OK — fecha e notifica total
    btn_ok.addActionListener(new ActionListener({
        actionPerformed: function() {
            cleanup();
            if (total_aplicados > 0) {
                new Notification("Concluído. Total de nós adicionados: " + total_aplicados + ".")
                    .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            } else {
                new Notification("Nenhum nó foi adicionado.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            }
        }
    }));

    // Cancelar — desfaz todas as inserções da sessão
    btn_can.addActionListener(new ActionListener({
        actionPerformed: function() {
            cleanup();
            if (total_aplicados > 0) {
                // cada Aplicar gerou 1 SequenceCommand — desfaz um por um
                // porém não temos contagem de quantos Aplicar foram clicados.
                // Guardamos o número de comandos separado.
                for (let i = 0; i < total_cmds; i++) UndoRedoHandler.getInstance().undo();
                layer.invalidate();
                new Notification("Cancelado. " + total_aplicados + " nó(s) removido(s).")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            } else {
                new Notification("Operação cancelada. Nenhuma alteração feita.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            }
        }
    }));

    windowAdapter = new WindowAdapter({
        windowClosing: function() {
            cleanup();
        }
    });
    dialog.addWindowListener(windowAdapter);

    atualizar_status();
    dialog.setVisible(true);
}