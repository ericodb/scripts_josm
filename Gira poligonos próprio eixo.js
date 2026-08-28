"use strict";

if (globalThis.__scriptCleanup__) {
    try { globalThis.__scriptCleanup__(); } catch(e) {}
}
if (globalThis.scriptCleanup) {
    try { globalThis.scriptCleanup(); } catch(e) {}
}

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const EastNorth       = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeCommand   = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");

const JDialog        = Java.type("javax.swing.JDialog");
const JPanel         = Java.type("javax.swing.JPanel");
const JButton        = Java.type("javax.swing.JButton");
const JLabel         = Java.type("javax.swing.JLabel");
const JRadioButton   = Java.type("javax.swing.JRadioButton");
const ButtonGroup    = Java.type("javax.swing.ButtonGroup");
const BoxLayout      = Java.type("javax.swing.BoxLayout");
const BorderFactory  = Java.type("javax.swing.BorderFactory");
const JSpinner       = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const UIManager      = Java.type("javax.swing.UIManager");
const TitledBorder   = Java.type("javax.swing.border.TitledBorder");
const FlowLayout     = Java.type("java.awt.FlowLayout");
const GridLayout     = Java.type("java.awt.GridLayout");
const ArrayList      = Java.type("java.util.ArrayList");
const SwingConstants = Java.type("javax.swing.SwingConstants");
const SwingUtilities = Java.type("javax.swing.SwingUtilities");
const WindowAdapter  = Java.extend(Java.type("java.awt.event.WindowAdapter"));

// --- Estado global do diálogo ---
var _activeDialog     = null;  // instância JDialog ativa
var _sourceDs         = null;  // DataSet da camada ao abrir
var _layerListener    = null;  // listener de remoção de camada
var windowAdapter     = null;  // listener de janela
var isCleanedUp       = false;

// --- LayerChangeListener no escopo global (padrão GraalVM) ---
const LayerChangeListener = Java.extend(
    Java.type("org.openstreetmap.josm.gui.layer.LayerManager$LayerChangeListener"), {
        layerAdded:        function (_e) {},
        layerOrderChanged: function (_e) {},
        layerRemoving:     function (e) {
            try {
                var removed = e.getRemovedLayer();
                if (removed && removed.data && removed.data === _sourceDs) {
                    SwingUtilities.invokeLater(function () {
                        cleanup();
                        new Notification("Camada removida. Diálogo fechado.")
                            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                    });
                }
            } catch (ex) {}
        }
    }
);

const cleanup = function() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    if (_layerListener !== null) {
        try { MainApplication.getLayerManager().removeLayerChangeListener(_layerListener); }
        catch (e) {}
        _layerListener = null;
    }
    _sourceDs = null;

    if (_activeDialog !== null) {
        try {
            var listeners = _activeDialog.getWindowListeners();
            for (var i = 0; i < listeners.length; i++) {
                _activeDialog.removeWindowListener(listeners[i]);
            }
        } catch (e) {}
        if (windowAdapter !== null) {
            try { _activeDialog.removeWindowListener(windowAdapter); } catch (e) {}
            windowAdapter = null;
        }
        try { _activeDialog.dispose(); } catch (e) {}
        _activeDialog = null;
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

// --- FUNÇÕES GEOMÉTRICAS ---

function calculateTotalArea(ways) {
    var proj = ProjectionRegistry.getProjection();
    var total = 0.0;
    ways.forEach(function(w) {
        var area = 0.0;
        var nodes = w.getNodes();
        if (nodes.size() < 3) return;
        for (var i = 0; i < nodes.size(); i++) {
            var a = proj.latlon2eastNorth(nodes.get(i).getCoor());
            var b = proj.latlon2eastNorth(nodes.get((i + 1) % nodes.size()).getCoor());
            area += a.east() * b.north() - b.east() * a.north();
        }
        total += Math.abs(area) / 2.0;
    });
    return total;
}

function getConnectedGroups(ways) {
    var groups = [];
    var visited = new Set();
    ways.forEach(function(w) {
        if (visited.has(w.getUniqueId())) return;
        var group = [];
        var stack = [w];
        visited.add(w.getUniqueId());
        while (stack.length > 0) {
            var current = stack.pop();
            group.push(current);
            var currentNodes = new Set();
            for (var i = 0; i < current.getNodesCount(); i++) currentNodes.add(current.getNode(i).getUniqueId());
            ways.forEach(function(other) {
                if (visited.has(other.getUniqueId())) return;
                for (var j = 0; j < other.getNodesCount(); j++) {
                    if (currentNodes.has(other.getNode(j).getUniqueId())) {
                        visited.add(other.getUniqueId());
                        stack.push(other);
                        break;
                    }
                }
            });
        }
        groups.push(group);
    });
    return groups;
}

function getFixedCentroid(ways) {
    var proj = ProjectionRegistry.getProjection();
    var e = [], n = [];
    ways.forEach(function(w) {
        for (var i = 0; i < w.getNodesCount(); i++) {
            var en = proj.latlon2eastNorth(w.getNode(i).getCoor());
            e.push(en.east()); n.push(en.north());
        }
    });
    return new EastNorth((Math.min.apply(null, e) + Math.max.apply(null, e)) / 2, (Math.min.apply(null, n) + Math.max.apply(null, n)) / 2);
}

function getAxisAngle(ways) {
    var proj = ProjectionRegistry.getProjection();
    var best = -1, angle = 0;
    ways.forEach(function(w) {
        for (var i = 0; i < w.getNodesCount() - 1; i++) {
            var a = proj.latlon2eastNorth(w.getNode(i).getCoor());
            var b = proj.latlon2eastNorth(w.getNode(i+1).getCoor());
            var d = Math.pow(b.east()-a.east(), 2) + Math.pow(b.north()-a.north(), 2);
            if (d > best) { best = d; angle = Math.atan2(b.north()-a.north(), b.east()-a.east()); }
        }
    });
    return angle;
}

// --- INTERFACE ---

function TransformDialog(ways) {
    var self = this;
    this.ways = ways;
    this.history = [];
    
    this.refreshGroups = function() {
        this.groups = getConnectedGroups(this.ways);
        this.groupCentroids = new Map();
        this.groups.forEach(function(g) {
            var centroid = getFixedCentroid(g);
            g.forEach(function(w) { self.groupCentroids.set(w.getUniqueId(), centroid); });
        });
        this.globalCentroid = getFixedCentroid(this.ways);
    };

    this.refreshGroups();

    var dialog = new JDialog(MainApplication.getMainFrame(), "Transformador de Polígonos", false);
    _activeDialog = dialog;
    var mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));

    // 1. TOPOLOGIA
    var topoP = new JPanel(new FlowLayout());
    topoP.setBorder(new TitledBorder("Topologia"));
    var btnDetach = new JButton("Desgrudar (Preserva ID)");
    btnDetach.addActionListener(function() { self.detachNodes(); });
    topoP.add(btnDetach);
    mainPanel.add(topoP);

    // 2. ÂNCORA
    var anchorP = new JPanel(new FlowLayout());
    anchorP.setBorder(new TitledBorder("Centro da Transformação"));
    this.rbIndiv = new JRadioButton("Cada grupo", true);
    this.rbGlobal = new JRadioButton("Global");
    var bg = new ButtonGroup(); bg.add(this.rbIndiv); bg.add(this.rbGlobal);
    anchorP.add(this.rbIndiv); anchorP.add(this.rbGlobal);
    mainPanel.add(anchorP);

    // 3. ROTAÇÃO
    var rotP = new JPanel(new GridLayout(2, 1));
    rotP.setBorder(new TitledBorder("Rotação"));
    this.spinRot = new JSpinner(new SpinnerNumberModel(180, 1, 360, 1));
    var btnRPlus = new JButton("⟲ (+)");
    var btnRMinus = new JButton("⟳ (-)");
    btnRPlus.addActionListener(function() { 
        try { self.spinRot.commitEdit(); } catch(e) {}
        self.applyTransform(Math.PI * parseFloat(self.spinRot.getValue()) / 180.0, 1.0, null); 
    });
    btnRMinus.addActionListener(function() { 
        try { self.spinRot.commitEdit(); } catch(e) {}
        self.applyTransform(-Math.PI * parseFloat(self.spinRot.getValue()) / 180.0, 1.0, null); 
    });
    rotP.add(this.spinRot);
    var rowR = new JPanel(); rowR.add(btnRMinus); rowR.add(btnRPlus);
    rotP.add(rowR);
    mainPanel.add(rotP);

    // 4. SIMETRIA
    var symP = new JPanel(new FlowLayout());
    symP.setBorder(new TitledBorder("Simetria"));
    var btnPara = new JButton("↔ Paralelo");
    var btnPerp = new JButton("↕ Perpendicular");
    btnPara.addActionListener(function() { self.applyTransform(0, 1.0, 'para'); });
    btnPerp.addActionListener(function() { self.applyTransform(0, 1.0, 'perp'); });
    symP.add(btnPara); symP.add(btnPerp);
    mainPanel.add(symP);

    // 5. ESCALA
    var scaleP = new JPanel(new GridLayout(2, 1));
    scaleP.setBorder(new TitledBorder("Escala"));
    this.areaLabel = new JLabel("Área Total: " + calculateTotalArea(ways).toFixed(2) + " m²");
    this.areaLabel.setHorizontalAlignment(SwingConstants.CENTER);
    this.spinScale = new JSpinner(new SpinnerNumberModel(5, 1, 100, 1));
    var btnSPlus = new JButton("➕");
    var btnSMinus = new JButton("➖");
    btnSPlus.addActionListener(function() { self.applyScale(1); });
    btnSMinus.addActionListener(function() { self.applyScale(-1); });
    scaleP.add(this.areaLabel);
    var rowS = new JPanel(); rowS.add(btnSMinus); rowS.add(btnSPlus);
    scaleP.add(rowS);
    mainPanel.add(scaleP);

    // RODAPÉ COM ÍCONES
    var footP = new JPanel(new FlowLayout(FlowLayout.RIGHT));
    var btnOk = new JButton("Aceitar", UIManager.getIcon("OptionPane.okIcon"));
    var btnCancel = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
    
    btnOk.addActionListener(function() {
        new Notification("Transformações finalizadas.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        cleanup();
    });
    btnCancel.addActionListener(function() {
        while(self.history.length > 0) {
            UndoRedoHandler.getInstance().undo();
            self.history.pop();
        }
        new Notification("Ações descartadas.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        cleanup();
    });
    footP.add(btnOk); footP.add(btnCancel);
    mainPanel.add(footP);

    windowAdapter = new WindowAdapter({
        windowClosing: function (_e) {
            SwingUtilities.invokeLater(function () {
                cleanup();
            });
        },
        windowClosed: function (_e) {}
    });
    dialog.addWindowListener(windowAdapter);

    dialog.add(mainPanel); dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
}

TransformDialog.prototype.detachNodes = function() {
    var self = this;
    var ds = MainApplication.getLayerManager().getEditLayer().data;
    var cmds = new ArrayList();
    var nodeUsage = new Map();
    this.ways.forEach(function(w) {
        for(var i=0; i<w.getNodesCount(); i++) {
            var n = w.getNode(i);
            if(!nodeUsage.has(n)) nodeUsage.set(n, []);
            nodeUsage.get(n).push(w);
        }
    });
    this.ways.forEach(function(way) {
        var newNodes = new ArrayList();
        var changed = false;
        // Mapeia nó original → novo nó criado para esta way
        // Necessário para reusar o mesmo nó no fechamento do polígono
        var replacedNodes = new Map();
        var lastIdx = way.getNodesCount() - 1;

        for(var i = 0; i <= lastIdx; i++) {
            var node = way.getNode(i);

            // Nó de fechamento de polígono: mesmo objeto que o nó [0]
            // Deve reusar o nó já criado (ou original) do índice 0
            if (i === lastIdx && way.isClosed()) {
                var firstNew = replacedNodes.get(way.getNode(0));
                newNodes.add(firstNew !== undefined ? firstNew : way.getNode(0));
                continue;
            }

            if (nodeUsage.get(node).length > 1 && nodeUsage.get(node)[0] !== way) {
                var newNode = new Node(node.getCoor());
                cmds.add(new AddCommand(ds, newNode));
                newNodes.add(newNode);
                replacedNodes.set(node, newNode);
                changed = true;
            } else {
                newNodes.add(node);
                replacedNodes.set(node, node);
            }
        }
        if (changed) {
            var wn = new Way(way); wn.setNodes(newNodes);
            cmds.add(new ChangeCommand(way, wn));
        }
    });
    if(!cmds.isEmpty()) {
        var seq = new SequenceCommand("Desgrudar", cmds);
        UndoRedoHandler.getInstance().add(seq);
        this.history.push(seq);
        this.refreshGroups();
    }
};

TransformDialog.prototype.applyScale = function(sign) {
    try { this.spinScale.commitEdit(); } catch(e) {}
    var factor = 1 + sign * parseFloat(this.spinScale.getValue()) / 100.0;
    this.applyTransform(0, factor, null);
};

TransformDialog.prototype.applyTransform = function(angle, scale, mirror) {
    var proj = ProjectionRegistry.getProjection();
    var cmds = new ArrayList();
    var isIndiv = this.rbIndiv.isSelected();
    var self = this;
    var processedNodes = new Set();

    this.ways.forEach(function(way) {
        var anchor = isIndiv ? self.groupCentroids.get(way.getUniqueId()) : self.globalCentroid;
        var mAxis = null;
        if (mirror) {
            var base = getAxisAngle([way]);
            mAxis = (mirror === 'para') ? base : base + Math.PI/2;
        }

        for (var i = 0; i < way.getNodesCount(); i++) {
            var node = way.getNode(i);
            if (processedNodes.has(node.getUniqueId())) continue;
            processedNodes.add(node.getUniqueId());

            var en = proj.latlon2eastNorth(node.getCoor());
            var x = (en.east() - anchor.east()) * scale;
            var y = (en.north() - anchor.north()) * scale;

            if (mAxis !== null) {
                var ca = Math.cos(-mAxis), sa = Math.sin(-mAxis);
                var tx = x * ca - y * sa, ty = x * sa + y * ca;
                ty = -ty;
                ca = Math.cos(mAxis); sa = Math.sin(mAxis);
                x = tx * ca - ty * sa;
                y = tx * sa + ty * ca;
            } else if (angle !== 0) {
                var c = Math.cos(angle), s = Math.sin(angle);
                var nx = x * c - y * s;
                var ny = x * s + y * c;
                x = nx; y = ny;
            }

            var nn = new Node(node);
            nn.setCoor(proj.eastNorth2latlon(new EastNorth(x + anchor.east(), y + anchor.north())));
            cmds.add(new ChangeCommand(node, nn));
        }
    });

    if(!cmds.isEmpty()) {
        var seq = new SequenceCommand("Transformar", cmds);
        UndoRedoHandler.getInstance().add(seq);
        this.history.push(seq);
        this.areaLabel.setText("Área Total: " + calculateTotalArea(this.ways).toFixed(2) + " m²");
    }
};

// --- RUN ---
var layer = MainApplication.getLayerManager().getEditLayer();
if (!layer || !layer.data) {
    new Notification("Nenhuma camada de edição ativa.")
        .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
} else {
    var sel = layer.data.getSelectedWays();
    var ways = [];
    var it = sel.iterator();
    while(it.hasNext()) { var w = it.next(); if(w.isClosed()) ways.push(w); }
    if (ways.length > 0) {
        _sourceDs      = layer.data;
        _layerListener = new LayerChangeListener();
        MainApplication.getLayerManager().addLayerChangeListener(_layerListener);
        new TransformDialog(ways);
    } else {
        new Notification("Selecione polígonos fechados.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    }
}
