"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const EastNorth       = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager       = Java.type("javax.swing.UIManager");
const ArrayList       = Java.type("java.util.ArrayList");

function calcularCentroide(way, proj) {
    let nodes = way.getNodes();
    let numNodes = nodes.size();
    
    // Ignora o último nó se for igual ao primeiro (fechamento)
    let count = way.isClosed() ? numNodes - 1 : numNodes;
    
    let sumEast = 0;
    let sumNorth = 0;

    for (let i = 0; i < count; i++) {
        let en = proj.latlon2eastNorth(nodes.get(i).getCoor());
        sumEast += en.east();
        sumNorth += en.north();
    }

    let avgEast = sumEast / count;
    let avgNorth = sumNorth / count;

    return proj.eastNorth2latlon(new EastNorth(avgEast, avgNorth));
}

function criarCentroidesComTags() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada de edição ativa!")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon"))
            .show();
        return;
    }

    const dataset = layer.data;
    const selecionados = dataset.getSelectedWays();

    if (selecionados.isEmpty()) {
        new Notification("Selecione pelo menos um polígono fechado.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .show();
        return;
    }

    const proj = ProjectionRegistry.getProjection();
    const comandos = new ArrayList();
    let countCriadors = 0;

    let it = selecionados.iterator();
    while (it.hasNext()) {
        let way = it.next();
        
        // Validação: precisa ter pelo menos 3 nós e ser fechado
        if (way.getNodesCount() < 3 || !way.isClosed()) {
            continue;
        }

        let centroLatLon = calcularCentroide(way, proj);
        let novoNode = new Node(centroLatLon);

        // Copiar tags do polígono para o ponto
        novoNode.setKeys(way.getKeys());

        comandos.add(new AddCommand(dataset, novoNode));
        countCriadors++;
    }

    if (!comandos.isEmpty()) {
        UndoRedoHandler.getInstance().add(new SequenceCommand("Criar centroides com tags", comandos));
        
        new Notification("Centroides foram criados com sucesso.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
            .show();
    } else {
        new Notification("Nenhum polígono válido selecionado.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .show();
    }
}

criarCentroidesComTags();