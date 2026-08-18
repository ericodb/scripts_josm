"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const MoveCommand     = Java.type("org.openstreetmap.josm.command.MoveCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager      = Java.type("javax.swing.UIManager");
const ArrayList      = Java.type("java.util.ArrayList");

function moveFromTo() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer) {
        new Notification("Nenhuma camada de edição ativa!")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon"))
            .show();
        return;
    }

    const selection = layer.data.getSelected();
    const selectedWays = [];
    const selectedNodes = [];

    const it = selection.iterator();
    while (it.hasNext()) {
        const obj = it.next();
        if (obj instanceof Way) {
            selectedWays.push(obj);
        } else if (obj instanceof Node) {
            selectedNodes.push(obj);
        }
    }

    if (selectedWays.length < 1) {
        new Notification("Selecione pelo menos uma linha (Way).")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
            .show();
        return;
    }

    if (selectedNodes.length !== 2) {
        new Notification("Selecione exatamente dois nós: um da linha e um de destino.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .show();
        return;
    }

    let nodeFrom = null;
    let nodeTo = null;

    // Identificar qual nó pertence às linhas selecionadas
    selectedNodes.forEach(function(n) {
        let belongsToWay = false;
        for (let i = 0; i < selectedWays.length; i++) {
            if (selectedWays[i].getNodes().contains(n)) {
                belongsToWay = true;
                break;
            }
        }
        if (belongsToWay) nodeFrom = n;
        else nodeTo = n;
    });

    if (!nodeFrom || !nodeTo) {
        new Notification("Erro: Um dos nós deve estar na linha e o outro fora.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .show();
        return;
    }

    // Cálculo do vetor de deslocamento
    const dx = nodeTo.getEastNorth().east() - nodeFrom.getEastNorth().east();
    const dy = nodeTo.getEastNorth().north() - nodeFrom.getEastNorth().north();

    // Coleta de nós únicos para evitar movimentos duplicados
    const nodesToMove = new Set();
    selectedWays.forEach(function(w) {
        const nodes = w.getNodes();
        for (let i = 0; i < nodes.size(); i++) {
            nodesToMove.add(nodes.get(i));
        }
    });

    // Criar comandos de movimento
    const commands = new ArrayList();
    nodesToMove.forEach(function(n) {
        commands.add(new MoveCommand(n, dx, dy));
    });

    if (!commands.isEmpty()) {
        UndoRedoHandler.getInstance().add(new SequenceCommand("Mover por referência", commands));
        new Notification("Movido com sucesso!")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
            .show();
    }
}

moveFromTo();