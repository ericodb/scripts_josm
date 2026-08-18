"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification = Java.type("org.openstreetmap.josm.gui.Notification");
const Way = Java.type("org.openstreetmap.josm.data.osm.Way");
const Node = Java.type("org.openstreetmap.josm.data.osm.Node");
const EastNorth = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const ChangeNodesCommand = Java.type("org.openstreetmap.josm.command.ChangeNodesCommand");
const AddCommand = Java.type("org.openstreetmap.josm.command.AddCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const JOptionPane = Java.type("javax.swing.JOptionPane");
const JPanel = Java.type("javax.swing.JPanel");
const JLabel = Java.type("javax.swing.JLabel");
const JSpinner = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const BoxLayout = Java.type("javax.swing.BoxLayout");
const Box = Java.type("javax.swing.Box");
const UIManager = Java.type("javax.swing.UIManager");
const Dimension = Java.type("java.awt.Dimension");

function isClockwise(way, projection) {
    var nodes = way.getNodes();
    var area = 0;
    for (var i = 0; i < nodes.size() - 1; i++) {
        var n1 = projection.latlon2eastNorth(nodes.get(i).getCoor());
        var n2 = projection.latlon2eastNorth(nodes.get(i + 1).getCoor());
        area += (n2.east() - n1.east()) * (n2.north() + n1.north());
    }
    return area > 0;
}

function calculateUniformVector(node, way, distance) {
    var projection = ProjectionRegistry.getProjection();
    var nodes = way.getNodes();
    var idx = -1;
    for (var i = 0; i < nodes.size(); i++) {
        if (nodes.get(i) === node) {
            idx = i;
            break;
        }
    }
    if (idx === -1) return null;

    var prevIdx = (idx - 1 + nodes.size()) % nodes.size();
    var nextIdx = (idx + 1) % nodes.size();

    var nodeEn = projection.latlon2eastNorth(node.getCoor());
    var prevEn = projection.latlon2eastNorth(nodes.get(prevIdx).getCoor());
    var nextEn = projection.latlon2eastNorth(nodes.get(nextIdx).getCoor());

    var v1x = nodeEn.east() - prevEn.east();
    var v1y = nodeEn.north() - prevEn.north();
    var v2x = nextEn.east() - nodeEn.east();
    var v2y = nextEn.north() - nodeEn.north();

    var avgx = (v1x + v2x) / 2.0;
    var avgy = (v1y + v2y) / 2.0;
    var mag = Math.sqrt(avgx * avgx + avgy * avgy);

    if (mag < 1e-6) return null;

    var cw = isClockwise(way, projection);
    var perpx = (cw ? avgy : -avgy) / mag * distance;
    var perpy = (cw ? -avgx : avgx) / mag * distance;

    return new EastNorth(nodeEn.east() + perpx, nodeEn.north() + perpy);
}

(function() {
    var layer = MainApplication.getLayerManager().getActiveDataLayer();
    if (!layer) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }
    
    var ds = layer.data;
    var selected = ds.getSelectedWays().toArray();
    var ways = selected.filter(function(w) { return !w.isDeleted() && w.getNodesCount() > 1; });

    if (ways.length < 2) {
        new Notification("Selecione pelo menos duas geometrias conectadas.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    var panel = new JPanel();
    panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
    panel.setPreferredSize(new Dimension(275, 150));
    panel.add(new JLabel("Informe a distância de deslocamento (m):"));
    
    var spinner = new JSpinner(new SpinnerNumberModel(10.0, 0.1, 100.0, 1.0));
    panel.add(spinner);
    panel.add(Box.createVerticalStrut(25));

    var info_label = new JLabel(
        "<html><i><span style='color:#99ff00;'>" +
        "*Ao selecionar Linha/Polígono, <br> o id do nó é preservado na linha.<br>" +
        "*Ao selecionar Polígono/Polígono, <br> o id do nó é preservado na primeira seleção." +
        "</span></i></html>"
    );
    panel.add(info_label);

    var result = JOptionPane.showConfirmDialog(null, panel, "Configuração de Deslocamento", JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
    if (result !== JOptionPane.OK_OPTION) return;
    var dist = spinner.getValue();

    var projection = ProjectionRegistry.getProjection();
    var nodeToWays = new Map();
    
    ways.forEach(function(w) {
        var nList = w.getNodes();
        for (var i = 0; i < nList.size(); i++) {
            var n = nList.get(i);
            if (!nodeToWays.has(n)) nodeToWays.set(n, []);
            if (nodeToWays.get(n).indexOf(w) === -1) nodeToWays.get(n).push(w);
        }
    });

    var plan = new Map();
    var addNodes = [];

    nodeToWays.forEach(function(waysUsing, originalNode) {
        if (waysUsing.length <= 1) return;
        
        var polygons = waysUsing.filter(function(w) { return w.isClosed(); });
        polygons.sort(function(a, b) { return ways.indexOf(a) - ways.indexOf(b); });
        
        var targets = (waysUsing.length > polygons.length) ? polygons : polygons.slice(1);

        targets.forEach(function(poly) {
            var posEn = calculateUniformVector(originalNode, poly, dist);
            if (!posEn) return;
            
            var newNode = new Node(projection.eastNorth2latlon(posEn));
            var polyNodes = poly.getNodes();
            var idxs = [];
            
            for (var i = 0; i < polyNodes.size(); i++) {
                if (polyNodes.get(i) === originalNode) idxs.push(i);
            }

            if (!plan.has(poly)) plan.set(poly, []);
            plan.get(poly).push({ indices: idxs, newNode: newNode });
            addNodes.push(newNode);
        });
    });

    if (addNodes.length === 0) {
        new Notification("Nenhum nó compartilhado encontrado.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    var cmds = new java.util.ArrayList();
    addNodes.forEach(function(n) { cmds.add(new AddCommand(ds, n)); });
    
    plan.forEach(function(entries, way) {
        var currentNodes = new java.util.ArrayList(way.getNodes());
        entries.forEach(function(e) {
            e.indices.forEach(function(idx) { 
                currentNodes.set(idx, e.newNode); 
            });
        });
        cmds.add(new ChangeNodesCommand(way, currentNodes));
    });

    UndoRedoHandler.getInstance().add(new SequenceCommand("Separar Geometria (" + addNodes.length + " nós)", cmds));
    new Notification("Separação concluída!")
        .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
})();