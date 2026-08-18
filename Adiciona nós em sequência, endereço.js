"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const DeleteCommand   = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const EastNorth       = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const UIManager      = Java.type("javax.swing.UIManager");
const JPanel         = Java.type("javax.swing.JPanel");
const JLabel         = Java.type("javax.swing.JLabel");
const JTextField     = Java.type("javax.swing.JTextField");
const JOptionPane    = Java.type("javax.swing.JOptionPane");
const GridLayout     = Java.type("java.awt.GridLayout");
const ArrayList      = Java.type("java.util.ArrayList");

// --- UTILITÁRIOS ---

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.east() - p2.east(), 2) + Math.pow(p1.north() - p2.north(), 2));
}

function findNearbyStreetName(en1, en2, dataset) {
    const proj = ProjectionRegistry.getProjection();
    let minDistance = Infinity;
    let streetName = "";

    const ways = dataset.getWays();
    const it = ways.iterator();
    while (it.hasNext()) {
        const way = it.next();
        if (!way.hasKey("addr:street")) continue;

        const nodes = way.getNodes();
        for (let i = 0; i < nodes.size(); i++) {
            let wn = proj.latlon2eastNorth(nodes.get(i).getCoor());
            let d1 = getDistance(en1, wn);
            let d2 = getDistance(en2, wn);
            let d = Math.min(d1, d2);
            
            if (d < minDistance) {
                minDistance = d;
                streetName = way.get("addr:street");
            }
        }
    }
    return streetName;
}

// --- CORE ---

function createHouseNumbers() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }
    const dataset = layer.data;

    const selection = dataset.getSelectedWays();
    if (selection.size() !== 1) {
        new Notification("Selecione uma única linha (Way) de dois nós.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    const way = selection.iterator().next();
    if (way.getNodesCount() !== 2) {
        new Notification("A linha precisa ter exatamente dois nós.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    const n1 = way.getNode(0);
    const n2 = way.getNode(1);
    const proj = ProjectionRegistry.getProjection();
    const en1 = proj.latlon2eastNorth(n1.getCoor());
    const en2 = proj.latlon2eastNorth(n2.getCoor());

    const suggestedStreet = findNearbyStreetName(en1, en2, dataset);

    // INTERFACE
    const panel = new JPanel(new GridLayout(4, 2, 5, 5));
    const txtNum = new JTextField("100");
    const txtStreet = new JTextField(suggestedStreet);
    const txtTotal = new JTextField("10");
    const txtInc = new JTextField("2");

    panel.add(new JLabel("Número inicial:")); panel.add(txtNum);
    panel.add(new JLabel("Nome da rua:")); panel.add(txtStreet);
    panel.add(new JLabel("Total de pontos:")); panel.add(txtTotal);
    panel.add(new JLabel("Incremento (+/-):")); panel.add(txtInc);

    const result = JOptionPane.showConfirmDialog(null, panel, "Gerador de Numeração", JOptionPane.OK_CANCEL_OPTION);
    if (result !== JOptionPane.OK_OPTION) return;

    try {
        let startNum = parseInt(txtNum.getText());
        let street = txtStreet.getText().trim();
        let total = parseInt(txtTotal.getText());
        let inc = parseInt(txtInc.getText());

        if (isNaN(startNum) || isNaN(total) || isNaN(inc) || total < 2) throw "Invalid";

        const commands = new ArrayList();

        for (let i = 0; i < total; i++) {
            let t = i / (total - 1);
            let x = en1.east() + (en2.east() - en1.east()) * t;
            let y = en1.north() + (en2.north() - en1.north()) * t;
            
            let newNode = new Node(proj.eastNorth2latlon(new EastNorth(x, y)));
            newNode.put("addr:housenumber", (startNum + (inc * i)).toString());
            if (street !== "") newNode.put("addr:street", street);
            
            commands.add(new AddCommand(dataset, newNode));
        }

        // LIMPEZA: Deletar a linha guia
        commands.add(new DeleteCommand(way));
        
        // Deleta nós das extremidades se estiverem órfãos
        if (n1.getReferrers().size() === 1) commands.add(new DeleteCommand(n1));
        if (n2.getReferrers().size() === 1) commands.add(new DeleteCommand(n2));

        UndoRedoHandler.getInstance().add(new SequenceCommand("Gerar Numeração", commands));
        new Notification("Endereços gerados com sucesso!").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();

    } catch (e) {
        new Notification("Erro nos valores inseridos.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    }
}

createHouseNumbers();