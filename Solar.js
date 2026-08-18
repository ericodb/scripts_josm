"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const DeleteCommand   = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");

const JOptionPane  = Java.type("javax.swing.JOptionPane");
const JPanel       = Java.type("javax.swing.JPanel");
const JLabel       = Java.type("javax.swing.JLabel");
const JRadioButton = Java.type("javax.swing.JRadioButton");
const ButtonGroup  = Java.type("javax.swing.ButtonGroup");
const BoxLayout    = Java.type("javax.swing.BoxLayout");
const Box          = Java.type("javax.swing.Box");
const UIManager    = Java.type("javax.swing.UIManager");
const ArrayList    = Java.type("java.util.ArrayList");

function deleteBlocksAndNodes() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada de dados ativa encontrada!")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon"))
            .show();
        return;
    }

    const dataset = layer.data;
    const selectedWays = dataset.getSelectedWays();
    const ways = [];
    
    let iter = selectedWays.iterator();
    while (iter.hasNext()) {
        let w = iter.next();
        if (w.isClosed() && w.isUsable()) {
            ways.push(w);
        }
    }

    if (ways.length < 3) {
        new Notification("Selecione pelo menos 3 polígonos conectados.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .show();
        return;
    }

    // Ordenação por centroide do polígono (média de todos os nós).
    // Usar getNode(0) falha com grades a 90° pois vários polígonos
    // têm exatamente o mesmo lon no nó 0 — a sequência fica instável.
    // O centroide é único para cada polígono e resolve o empate.
    function centroide(way) {
        const nodes = way.getNodes();
        let sumLon = 0, sumLat = 0;
        for (let k = 0; k < nodes.size(); k++) {
            sumLon += nodes.get(k).getCoor().lon();
            sumLat += nodes.get(k).getCoor().lat();
        }
        return { lon: sumLon / nodes.size(), lat: sumLat / nodes.size() };
    }
    ways.sort((a, b) => {
        const ca = centroide(a), cb = centroide(b);
        const dLon = ca.lon - cb.lon;
        if (Math.abs(dLon) > 1e-10) return dLon;  // desempate por lat se lon igual
        return ca.lat - cb.lat;
    });

    const nodeToBlocks = new Map();
    ways.forEach(way => {
        let nodes = way.getNodes();
        for (let i = 0; i < nodes.size(); i++) {
            let node = nodes.get(i);
            if (!nodeToBlocks.has(node)) nodeToBlocks.set(node, []);
            nodeToBlocks.get(node).push(way);
        }
    });

    const processedBlocks = new Set();
    const connectedSequences = [];

    ways.forEach(way => {
        if (processedBlocks.has(way)) return;
        let sequence = [];
        let toProcess = [way];

        while (toProcess.length > 0) {
            let current = toProcess.pop();
            if (processedBlocks.has(current)) continue;
            sequence.push(current);
            processedBlocks.add(current);
            let nodes = current.getNodes();
            for (let i = 0; i < nodes.size(); i++) {
                let node = nodes.get(i);
                let connected = nodeToBlocks.get(node) || [];
                connected.forEach(cw => {
                    if (!processedBlocks.has(cw)) toProcess.push(cw);
                });
            }
        }
        if (sequence.length >= 3) connectedSequences.push(sequence);
    });

    // Se após o agrupamento não houver sequências válidas
    if (connectedSequences.length === 0) {
        new Notification("Nenhuma sequência de 3 ou mais blocos conectada.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon"))
            .show();
        return;
    }

    const panel = new JPanel();
    panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
    const info = new JLabel("<html><b>Escolha o método de remoção:</b></html>");
    panel.add(info);
    panel.add(Box.createVerticalStrut(12));

    const rb1 = new JRadioButton("Remover dois a cada três blocos", true);
    const rb2 = new JRadioButton("Remover blocos alternados");
    const group = new ButtonGroup();
    group.add(rb1); group.add(rb2);
    panel.add(rb1); panel.add(rb2);

    const result = JOptionPane.showConfirmDialog(
        MainApplication.getMainFrame(), 
        panel, 
        "Seleção de Método",
        JOptionPane.OK_CANCEL_OPTION, 
        JOptionPane.PLAIN_MESSAGE
    );

    if (result !== JOptionPane.OK_OPTION) {
        new Notification("Ação cancelada pelo usuário.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
            .show();
        return;
    }

    const toDeleteBlocks = [];
    connectedSequences.forEach(sequence => {
        if (rb1.isSelected()) {
            sequence.forEach((way, i) => {
                if ((i % 3) === 1 || (i % 3) === 2) toDeleteBlocks.push(way);
            });
        } else {
            for (let i = 1; i < sequence.length - 1; i += 2) {
                toDeleteBlocks.push(sequence[i]);
            }
        }
    });

    const cmds = new ArrayList();

    // Coletar nós órfãos antes de deletar as ways — verificar referências não deletadas
    const waysParaDeletar = new Set(toDeleteBlocks);
    const nodosParaDeletar = new Set();
    toDeleteBlocks.forEach(w => {
        const nodes = w.getNodes();
        for (let i = 0; i < nodes.size(); i++) {
            const node = nodes.get(i);
            if (node.isDeleted()) continue;
            const refs = node.getReferrers();
            let soNasWaysDeletadas = true;
            for (let r = 0; r < refs.size(); r++) {
                if (!refs.get(r).isDeleted() && !waysParaDeletar.has(refs.get(r))) {
                    soNasWaysDeletadas = false;
                    break;
                }
            }
            if (soNasWaysDeletadas) nodosParaDeletar.add(node);
        }
    });

    // Um único SequenceCommand — ways + nós orphãos — um único Ctrl+Z
    toDeleteBlocks.forEach(w => cmds.add(new DeleteCommand(w)));
    nodosParaDeletar.forEach(n => cmds.add(new DeleteCommand(n)));

    if (!cmds.isEmpty()) {
        UndoRedoHandler.getInstance().add(
            new SequenceCommand("Remover polígonos e nós órfãos", cmds));
    }

    new Notification("Sucesso: " + toDeleteBlocks.length + " polígonos e " +
        nodosParaDeletar.size + " nós removidos.")
        .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
        .show();
}

deleteBlocksAndNodes();