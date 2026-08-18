"use strict";

// IMPORTS
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const DeleteCommand   = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const LatLon          = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");

const JDialog         = Java.type("javax.swing.JDialog");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JButton         = Java.type("javax.swing.JButton");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const Box             = Java.type("javax.swing.Box");
const UIManager       = Java.type("javax.swing.UIManager");
const JRadioButton    = Java.type("javax.swing.JRadioButton");
const ButtonGroup     = Java.type("javax.swing.ButtonGroup");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const TitledBorder    = Java.type("javax.swing.border.TitledBorder");
const WindowAdapter   = Java.extend(Java.type("java.awt.event.WindowAdapter"));
const ActionListener  = Java.extend(Java.type("java.awt.event.ActionListener"));
const Dimension       = Java.type("java.awt.Dimension");
const FlowLayout      = Java.type("java.awt.FlowLayout");
const BorderLayout    = Java.type("java.awt.BorderLayout");
const ArrayList       = Java.type("java.util.ArrayList");
const Color           = Java.type("java.awt.Color");

// ESTADO GLOBAL
var state = {
    polyWidth: 0, polyHeight: 0,
    cavityXWidth: 0, cavityYWidth: 0,
    cavityXDepth: 0, cavityYDepth: 0,
    dirXOut: false, dirYOut: false,
    cavityMode: 0,
    previewCmd: null, deleteCmdRef: null,
    referenceTags: {}, centerLatLon: null, anglePoly: 0,
    labels: {}, btns: {}, defaults: {},
    m_per_deg_lat: 111319.492, m_per_deg_lon: 0
};

// FUNÇÕES AUXILIARES
function getMetricConversion(lat) {
    var lat_rad = (Math.PI / 180) * lat;
    return state.m_per_deg_lat * Math.cos(lat_rad);
}

function rotatePoint(x, y, angle) {
    return {
        x: x * Math.cos(angle) - y * Math.sin(angle),
        y: x * Math.sin(angle) + y * Math.cos(angle)
    };
}

function validarGeometria(W, H, CW_X, CW_Y, D_X, D_Y, mode) {
    var erros = [];
    if (mode === 0 || mode === 2) {
        if (CW_X >= W) erros.push("Largura da cavidade X (" + CW_X.toFixed(2) + "m) maior ou igual à largura total (" + W.toFixed(2) + "m).");
        if (D_Y >= H / 2) erros.push("Profundidade Y (" + D_Y.toFixed(2) + "m) maior ou igual à metade da altura (" + (H/2).toFixed(2) + "m).");
    }
    if (mode === 0 || mode === 1) {
        if (CW_Y >= H) erros.push("Largura da cavidade Y (" + CW_Y.toFixed(2) + "m) maior ou igual à altura total (" + H.toFixed(2) + "m).");
        if (D_X >= W / 2) erros.push("Profundidade X (" + D_X.toFixed(2) + "m) maior ou igual à metade da largura (" + (W/2).toFixed(2) + "m).");
    }
    return erros;
}

function generateGeometry(W, H, CW_X, CW_Y, D_X, D_Y, mode, outX, outY) {
    var hw = W / 2, hh = H / 2, h_cw_x = CW_X / 2, h_cw_y = CW_Y / 2;
    var basePoints = [{x: hw, y: hh}, {x: -hw, y: hh}, {x: -hw, y: -hh}, {x: hw, y: -hh}];
    var finalPoints = [];

    for (var i = 0; i < 4; i++) {
        var p1 = basePoints[i], p2 = basePoints[(i + 1) % 4];
        finalPoints.push(p1);
        if (mode === 1 && (i === 0 || i === 2)) continue;
        if (mode === 2 && (i === 1 || i === 3)) continue;

        if (Math.abs(p1.y - p2.y) < 1e-4) {
            var yEdge = p1.y, xMid = (p1.x + p2.x) / 2;
            var inwardDir = (yEdge > 0) ? -1 : 1;
            if (outY) inwardDir *= -1;
            var yD = yEdge + (D_Y * inwardDir);
            if (i === 0) {
                finalPoints.push({x: xMid + h_cw_x, y: yEdge}, {x: xMid + h_cw_x, y: yD}, {x: xMid - h_cw_x, y: yD}, {x: xMid - h_cw_x, y: yEdge});
            } else {
                finalPoints.push({x: xMid - h_cw_x, y: yEdge}, {x: xMid - h_cw_x, y: yD}, {x: xMid + h_cw_x, y: yD}, {x: xMid + h_cw_x, y: yEdge});
            }
        } else {
            var xEdge = p1.x, yMid = (p1.y + p2.y) / 2;
            var inwardDir = (xEdge > 0) ? -1 : 1;
            if (outX) inwardDir *= -1;
            var xD = xEdge + (D_X * inwardDir);
            if (i === 1) {
                finalPoints.push({x: xEdge, y: yMid + h_cw_y}, {x: xD, y: yMid + h_cw_y}, {x: xD, y: yMid - h_cw_y}, {x: xEdge, y: yMid - h_cw_y});
            } else {
                finalPoints.push({x: xEdge, y: yMid - h_cw_y}, {x: xD, y: yMid - h_cw_y}, {x: xD, y: yMid + h_cw_y}, {x: xEdge, y: yMid + h_cw_y});
            }
        }
    }
    return finalPoints;
}

function desenharPreview() {
    if (state.previewCmd) {
        UndoRedoHandler.getInstance().undo();
        state.previewCmd = null;
    }

    var layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !state.centerLatLon) return;

    var erros = validarGeometria(
        state.polyWidth, state.polyHeight,
        state.cavityXWidth, state.cavityYWidth,
        state.cavityXDepth, state.cavityYDepth,
        state.cavityMode
    );
    if (erros.length > 0) {
        new Notification("<html>Geometria inválida:<br>" + erros.join("<br>") + "</html>")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    try {
        var points = generateGeometry(
            state.polyWidth, state.polyHeight,
            state.cavityXWidth, state.cavityYWidth,
            state.cavityXDepth, state.cavityYDepth,
            state.cavityMode, state.dirXOut, state.dirYOut
        );

        var cmds = new ArrayList(), nodes = new ArrayList();

        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            var rot = rotatePoint(p.x, p.y, state.anglePoly);
            var newLon = state.centerLatLon.lon() + (rot.x / state.m_per_deg_lon);
            var newLat = state.centerLatLon.lat() + (rot.y / state.m_per_deg_lat);

            if (isNaN(newLat) || isNaN(newLon)) throw "Coordenada inválida";

            var n = new Node(new LatLon(newLat, newLon));
            cmds.add(new AddCommand(layer.data, n));
            nodes.add(n);
        }

        var way = new Way();
        var wayNodes = new ArrayList(nodes);
        wayNodes.add(nodes.get(0));
        way.setNodes(wayNodes);

        for (var k in state.referenceTags) {
            way.put(k, state.referenceTags[k]);
        }

        cmds.add(new AddCommand(layer.data, way));
        state.previewCmd = new SequenceCommand("Modulado H", cmds);
        UndoRedoHandler.getInstance().add(state.previewCmd);
        layer.invalidate();

    } catch (e) {
        java.lang.System.err.println("Erro no preview: " + e);
        new Notification("Erro na geometria.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
    }
}

// FUNÇÃO PRINCIPAL
function main() {
    var layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer) {
        new Notification("Nenhuma camada de edição ativa.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    var sel = layer.data.getSelectedWays().iterator();
    if (!sel.hasNext()) {
        new Notification("Selecione um polígono.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    var poly = sel.next();
    if (!poly.isClosed() || poly.getNodesCount() < 4) {
        new Notification("Não é um polígono válido.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    var ns = poly.getNodes();

    var c1 = ns.get(0).getCoor();
    var c2 = ns.get(1).getCoor();
    var c3 = ns.get(2).getCoor();

    state.m_per_deg_lon = getMetricConversion((c1.lat() + c2.lat()) / 2.0);

    var dx1 = (c2.lon() - c1.lon()) * state.m_per_deg_lon;
    var dy1 = (c2.lat() - c1.lat()) * state.m_per_deg_lat;
    state.polyWidth = Math.hypot(dx1, dy1);

    var dx2 = (c3.lon() - c2.lon()) * state.m_per_deg_lon;
    var dy2 = (c3.lat() - c2.lat()) * state.m_per_deg_lat;
    state.polyHeight = Math.hypot(dx2, dy2);

    if (state.polyWidth < 0.1 || state.polyHeight < 0.1) {
        new Notification("Polígono muito pequeno.").show();
        return;
    }

    var sumLat = 0, sumLon = 0, count = ns.size() - 1;
    for (var i = 0; i < count; i++) {
        sumLat += ns.get(i).getCoor().lat();
        sumLon += ns.get(i).getCoor().lon();
    }
    state.centerLatLon = new LatLon(sumLat / count, sumLon / count);
    state.anglePoly = Math.atan2(dy1, dx1);

    state.defaults = {
        w: state.polyWidth, h: state.polyHeight,
        cwx: state.polyWidth  / 3,
        cwy: state.polyHeight / 3,
        dx:  state.polyWidth  / 10,
        dy:  state.polyHeight / 10
    };

    state.cavityXWidth = state.defaults.cwx;
    state.cavityYWidth = state.defaults.cwy;
    state.cavityXDepth = state.defaults.dx;
    state.cavityYDepth = state.defaults.dy;

    var keys = poly.getKeys();
    state.referenceTags = {};
    var it = keys.entrySet().iterator();
    while (it.hasNext()) {
        var e = it.next();
        state.referenceTags[e.getKey()] = e.getValue();
    }

    var delList = new ArrayList();
    delList.add(poly);
    for (var i = 0; i < ns.size(); i++) {
        if (ns.get(i).getParentWays().size() === 1) delList.add(ns.get(i));
    }
    state.deleteCmdRef = new DeleteCommand(delList);
    UndoRedoHandler.getInstance().add(state.deleteCmdRef);

    // ── UI ───────────────────────────────────────
    var dialog = new JDialog(MainApplication.getMainFrame(), "Modulador de Edifício Tipo H", false);
    var mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(10, 15, 10, 15));

    var fmt = function(v) { return Number(v).toFixed(2); };

    var updateLabels = function() {
        state.labels.w.setText(  "Largura Total: "       + fmt(state.polyWidth)    + " m");
        state.labels.h.setText(  "Altura Total: "        + fmt(state.polyHeight)   + " m");
        state.labels.cwx.setText("Largura Cavidade X: "  + fmt(state.cavityXWidth) + " m");
        state.labels.cwy.setText("Largura Cavidade Y: "  + fmt(state.cavityYWidth) + " m");
        state.labels.dx.setText( "Profundidade X: "      + fmt(state.cavityXDepth) + " m");
        state.labels.dy.setText( "Profundidade Y: "      + fmt(state.cavityYDepth) + " m");
    };

    var getMaxForKey = function(stateKey) {
        switch (stateKey) {
            case "polyWidth":    return Infinity;
            case "polyHeight":   return Infinity;
            case "cavityXWidth": return state.polyWidth  - 0.01;
            case "cavityYWidth": return state.polyHeight - 0.01;
            case "cavityXDepth": return (state.polyWidth  / 2) - 0.01;
            case "cavityYDepth": return (state.polyHeight / 2) - 0.01;
            default:             return Infinity;
        }
    };

    state.step = 0.5;
    var allStepButtons = [];

    var createControlRow = function(labelKey, stateKey) {
        var p = new JPanel(new BorderLayout());
        state.labels[labelKey] = new JLabel();
        var bPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 0));

        var btnMinus = new JButton("-" + state.step.toFixed(1));
        btnMinus.setPreferredSize(new Dimension(58, 24));
        btnMinus.addActionListener(new ActionListener({
            actionPerformed: function() {
                state[stateKey] = Math.max(0.01, state[stateKey] - state.step);
                updateLabels();
                desenharPreview();
            }
        }));

        var btnPlus = new JButton("+" + state.step.toFixed(1));
        btnPlus.setPreferredSize(new Dimension(58, 24));
        btnPlus.addActionListener(new ActionListener({
            actionPerformed: function() {
                var novoValor = state[stateKey] + state.step;
                var maxVal = getMaxForKey(stateKey);
                if (state[stateKey] >= maxVal) return;

                var estadoTeste = {
                    polyWidth:    state.polyWidth,
                    polyHeight:   state.polyHeight,
                    cavityXWidth: state.cavityXWidth,
                    cavityYWidth: state.cavityYWidth,
                    cavityXDepth: state.cavityXDepth,
                    cavityYDepth: state.cavityYDepth
                };
                estadoTeste[stateKey] = novoValor;

                var erros = validarGeometria(
                    estadoTeste.polyWidth,  estadoTeste.polyHeight,
                    estadoTeste.cavityXWidth, estadoTeste.cavityYWidth,
                    estadoTeste.cavityXDepth, estadoTeste.cavityYDepth,
                    state.cavityMode
                );

                if (erros.length > 0) {
                    new Notification("<html>Limite atingido:<br>" + erros.join("<br>") + "</html>")
                        .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                    return;
                }

                state[stateKey] = novoValor;
                updateLabels();
                desenharPreview();
            }
        }));

        bPanel.add(btnMinus);
        bPanel.add(btnPlus);
        allStepButtons.push({ minus: btnMinus, plus: btnPlus });

        p.add(state.labels[labelKey], BorderLayout.WEST);
        p.add(Box.createHorizontalStrut(30), BorderLayout.CENTER);
        p.add(bPanel, BorderLayout.EAST);
        p.setBorder(BorderFactory.createEmptyBorder(2, 0, 2, 0));
        return p;
    };

    var updateStepButtons = function() {
        allStepButtons.forEach(function(pair) {
            pair.minus.setText("-" + state.step.toFixed(1));
            pair.plus.setText( "+" + state.step.toFixed(1));
        });
    };

    var pStep = new JPanel();
    pStep.setLayout(new BoxLayout(pStep, BoxLayout.Y_AXIS));
    pStep.setBorder(BorderFactory.createTitledBorder("Passo"));
    var groupStep = new ButtonGroup();
    [{ label: "0,1 m", val: 0.1 }, { label: "0,5 m", val: 0.5 }, { label: "1,0 m", val: 1.0 }].forEach(function(opt, i) {
        var rb = new JRadioButton(opt.label, i === 1);
        rb.addActionListener(new ActionListener({
            actionPerformed: function() {
                state.step = opt.val;
                updateStepButtons();
            }
        }));
        groupStep.add(rb);
        pStep.add(rb);
    });

    var pCount = new JPanel();
    pCount.setLayout(new BoxLayout(pCount, BoxLayout.Y_AXIS));
    pCount.setBorder(BorderFactory.createTitledBorder("Configuração de Cavidades"));
    var groupCount = new ButtonGroup();
    ["4 Cavidades", "Lados (Direita/Esquerda)", "Topo/Fundo"].forEach(function(m, i) {
        var rb = new JRadioButton(m, i === 0);
        rb.addActionListener(new ActionListener({
            actionPerformed: function() {
                state.cavityMode = i;
                updateEnableStates();
                desenharPreview();
            }
        }));
        groupCount.add(rb);
        pCount.add(rb);
    });

    var pTopRow = new JPanel(new BorderLayout(10, 0));
    pTopRow.add(pStep,  BorderLayout.WEST);
    pTopRow.add(pCount, BorderLayout.CENTER);
    mainPanel.add(pTopRow);

    var pDim = new JPanel();
    pDim.setLayout(new BoxLayout(pDim, BoxLayout.Y_AXIS));
    pDim.setBorder(BorderFactory.createTitledBorder("Dimensões Totais"));
    pDim.add(createControlRow("w", "polyWidth"));
    pDim.add(createControlRow("h", "polyHeight"));
    mainPanel.add(pDim);

    var getDirPanel = function(stateProp) {
        var p = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 0));
        var g = new ButtonGroup();
        var r1 = new JRadioButton("Dentro", true);
        r1.addActionListener(new ActionListener({
            actionPerformed: function() { state[stateProp] = false; desenharPreview(); }
        }));
        var r2 = new JRadioButton("Fora", false);
        r2.addActionListener(new ActionListener({
            actionPerformed: function() { state[stateProp] = true; desenharPreview(); }
        }));
        g.add(r1); g.add(r2);
        p.add(new JLabel("Direção: "));
        p.add(r1); p.add(r2);
        return { panel: p, radios: [r1, r2] };
    };

    var pSide = new JPanel();
    pSide.setLayout(new BoxLayout(pSide, BoxLayout.Y_AXIS));
    pSide.setBorder(BorderFactory.createTitledBorder("Lados: Direito / Esquerdo"));
    var resX = getDirPanel("dirXOut");
    state.btns.dirX = resX.radios;
    pSide.add(resX.panel);
    pSide.add(createControlRow("cwy", "cavityYWidth"));
    pSide.add(createControlRow("dx",  "cavityXDepth"));
    mainPanel.add(pSide);

    var pTop = new JPanel();
    pTop.setLayout(new BoxLayout(pTop, BoxLayout.Y_AXIS));
    pTop.setBorder(BorderFactory.createTitledBorder("Lados: Cima / Baixo"));
    var resY = getDirPanel("dirYOut");
    state.btns.dirY = resY.radios;
    pTop.add(resY.panel);
    pTop.add(createControlRow("cwx", "cavityXWidth"));
    pTop.add(createControlRow("dy",  "cavityYDepth"));
    mainPanel.add(pTop);

    function setPanelEnabled(panel, isEnabled) {
        panel.setEnabled(isEnabled);
        var border = panel.getBorder();
        if (border instanceof TitledBorder) {
            border.setTitleColor(isEnabled ? UIManager.getColor("TitledBorder.titleColor") : Color.GRAY);
        }
        var comps = panel.getComponents();
        for (var i = 0; i < comps.length; i++) {
            var c = comps[i];
            if (c instanceof JPanel) setPanelEnabled(c, isEnabled);
            else c.setEnabled(isEnabled);
        }
    }

    function updateEnableStates() {
        var ex = (state.cavityMode === 0 || state.cavityMode === 1);
        var ey = (state.cavityMode === 0 || state.cavityMode === 2);
        setPanelEnabled(pSide, ex);
        setPanelEnabled(pTop,  ey);
    }

    var pBottom = new JPanel();
    pBottom.setLayout(new BoxLayout(pBottom, BoxLayout.Y_AXIS));

    // Arredonda para o múltiplo de 0,5 mais próximo
    var arredondar05 = function(v) { return Math.round(v * 2) / 2; };

    var pReset = new JPanel(new FlowLayout(FlowLayout.CENTER, 8, 4));

    var btnArredondar = new JButton("Arredondar para 0,5");
    btnArredondar.setIcon(UIManager.getIcon("FileView.fileIcon"));
    btnArredondar.addActionListener(new ActionListener({
        actionPerformed: function() {
            state.polyWidth    = arredondar05(state.polyWidth);
            state.polyHeight   = arredondar05(state.polyHeight);
            state.cavityXWidth = arredondar05(state.cavityXWidth);
            state.cavityYWidth = arredondar05(state.cavityYWidth);
            state.cavityXDepth = arredondar05(state.cavityXDepth);
            state.cavityYDepth = arredondar05(state.cavityYDepth);
            updateLabels();
            desenharPreview();
        }
    }));

    var btnReset = new JButton("Resetar Configurações");
    btnReset.setIcon(UIManager.getIcon("FileView.fileIcon"));
    btnReset.addActionListener(new ActionListener({
        actionPerformed: function() {
            state.polyWidth    = state.defaults.w;
            state.polyHeight   = state.defaults.h;
            state.cavityXWidth = state.defaults.cwx;
            state.cavityYWidth = state.defaults.cwy;
            state.cavityXDepth = state.defaults.dx;
            state.cavityYDepth = state.defaults.dy;
            updateLabels();
            desenharPreview();
            new Notification("Dimensões restauradas.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    }));
    pReset.add(btnArredondar);
    pReset.add(btnReset);

    var pFinal = new JPanel(new FlowLayout(FlowLayout.CENTER, 15, 10));

    var btnOk = new JButton("Confirmar");
    btnOk.setIcon(UIManager.getIcon("OptionPane.okIcon"));
    btnOk.addActionListener(new ActionListener({
        actionPerformed: function() {
            new Notification("Polígono criado com sucesso.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            dialog.dispose();
        }
    }));

    var btnCancel = new JButton("Cancelar");
    btnCancel.setIcon(UIManager.getIcon("OptionPane.noIcon"));

    var cancelar = function() {
        if (state.previewCmd) {
            UndoRedoHandler.getInstance().undo();
            state.previewCmd = null;
        }
        if (state.deleteCmdRef) {
            UndoRedoHandler.getInstance().undo();
            state.deleteCmdRef = null;
        }
        new Notification("Cancelado.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    };

    btnCancel.addActionListener(new ActionListener({
        actionPerformed: function() {
            cancelar();
            dialog.dispose();
        }
    }));

    dialog.addWindowListener(new WindowAdapter({
        windowClosing: function() { cancelar(); }
    }));

    pFinal.add(btnOk);
    pFinal.add(btnCancel);
    pBottom.add(pReset);
    pBottom.add(pFinal);

    updateLabels();
    updateEnableStates();
    desenharPreview();

    dialog.add(mainPanel, BorderLayout.CENTER);
    dialog.add(pBottom, BorderLayout.SOUTH);

    dialog.pack();
    dialog.setSize(new Dimension(375, dialog.getPreferredSize().height + 20));
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
}

main();
