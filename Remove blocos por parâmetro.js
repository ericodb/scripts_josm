"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const DeleteCommand   = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const JOptionPane     = Java.type("javax.swing.JOptionPane");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JTextField      = Java.type("javax.swing.JTextField");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const Box             = Java.type("javax.swing.Box");
const UIManager       = Java.type("javax.swing.UIManager");
const ArrayList       = Java.type("java.util.ArrayList");
const HashSet         = Java.type("java.util.HashSet");

(function() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada de dados ativa encontrada!")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    const dataset = layer.data;
    const selected = dataset.getSelectedWays();
    let ways = [];
    
    const itSelected = selected.iterator();
    while (itSelected.hasNext()) {
        const w = itSelected.next();
        if (w.isClosed() && w.isUsable() && w.getNodesCount() > 0) {
            ways.push(w);
        }
    }

    if (ways.length === 0) {
        new Notification("Selecione ao menos um polígono fechado.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    // Ordenação por centroide do polígono — estável mesmo com grades a 90°
    // onde vários polígonos têm exatamente o mesmo lon no nó 0.
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
        if (Math.abs(dLon) > 1e-10) return dLon;
        return ca.lat - cb.lat;
    });

    // Mapeamento de nós para blocos
    const nodeToBlocks = new Map();
    ways.forEach(way => {
        const nodes = way.getNodes().iterator();
        while (nodes.hasNext()) {
            const node = nodes.next();
            if (!nodeToBlocks.has(node)) nodeToBlocks.set(node, []);
            nodeToBlocks.get(node).push(way);
        }
    });

    // Detectar sequências conectadas
    const processedBlocks = new Set();
    const connectedSequences = [];
    ways.forEach(way => {
        if (processedBlocks.has(way)) return;
        let sequence = [], toProcess = [way];
        while (toProcess.length > 0) {
            let current = toProcess.pop();
            if (processedBlocks.has(current)) continue;
            sequence.push(current);
            processedBlocks.add(current);
            const currentNodes = current.getNodes().iterator();
            while (currentNodes.hasNext()) {
                (nodeToBlocks.get(currentNodes.next()) || []).forEach(cw => {
                    if (!processedBlocks.has(cw)) toProcess.push(cw);
                });
            }
        }
        if (sequence.length >= 2) connectedSequences.push(sequence);
    });

    // --- Interface Gráfica ---
    const panel = new JPanel();
    panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));

    const seqField = new JTextField("2", 10);
    const blocosField = new JTextField("1", 10);
    const infoLabel = new JLabel("<html><i><span style='color:#b8860b;'>"
        + "O número de blocos a remover não pode ser maior ou igual à sequência.<br>"
        + "Índice zero = primeiro bloco. Ex: (0, 2) remove o 1º e o 3º.<br>"
        + "Sequências menores que 2 blocos são ignoradas."
        + "</span></i></html>");

    panel.add(new JLabel("Tamanho da sequência:"));
    panel.add(seqField);
    panel.add(new JLabel("Blocos a remover (índices separados por vírgula):"));
    panel.add(blocosField);
    panel.add(Box.createVerticalStrut(10));
    panel.add(infoLabel);

    const result = JOptionPane.showConfirmDialog(
        MainApplication.getMainFrame(), 
        panel, 
        "Parâmetros de Remoção", 
        JOptionPane.OK_CANCEL_OPTION, 
        JOptionPane.PLAIN_MESSAGE
    );

    if (result !== JOptionPane.OK_OPTION) return;

    try {
        const sequenceSize = parseInt(seqField.getText().trim());
        if (isNaN(sequenceSize) || sequenceSize < 1)
            throw new Error("Tamanho de sequência inválido: deve ser inteiro >= 1.");
        const indicesToRemove = new Set(
            blocosField.getText().split(',')
                .map(x => parseInt(x.trim()))
                .filter(n => !isNaN(n) && n >= 0 && n < sequenceSize)
        );
        if (indicesToRemove.size === 0)
            throw new Error("Nenhum índice válido. Use inteiros entre 0 e " + (sequenceSize - 1) + ".");

        let waysToDelete = new ArrayList();
        let nodesPotentialOrphans = new HashSet();

        connectedSequences.forEach(seq => {
            seq.forEach((way, i) => {
                if (indicesToRemove.has(i % sequenceSize)) {
                    waysToDelete.add(way);
                    const nodes = way.getNodes().iterator();
                    while(nodes.hasNext()) nodesPotentialOrphans.add(nodes.next());
                }
            });
        });

        if (waysToDelete.isEmpty()) {
            new Notification("Nenhum bloco encontrado para os critérios.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const cmds = new ArrayList();
        cmds.add(new DeleteCommand(dataset, waysToDelete));

        // Limpeza de órfãos: verifica se o nó é usado por algo que NÃO será deletado
        let nodesToDelete = new ArrayList();
        const itOrphans = nodesPotentialOrphans.iterator();
        while (itOrphans.hasNext()) {
            const node = itOrphans.next();
            const referrers = node.getReferrers().iterator();
            let stillInUse = false;
            while (referrers.hasNext()) {
                const ref = referrers.next();
                if (!waysToDelete.contains(ref)) {
                    stillInUse = true;
                    break;
                }
            }
            if (!stillInUse && !node.isDeleted()) {
                nodesToDelete.add(node);
            }
        }

        if (!nodesToDelete.isEmpty()) {
            cmds.add(new DeleteCommand(dataset, nodesToDelete));
        }

        UndoRedoHandler.getInstance().add(new SequenceCommand("Remover blocos e nós órfãos", cmds));

        new Notification("Sucesso: " + waysToDelete.size() + " blocos e " + nodesToDelete.size() + " nós removidos.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();

    } catch (err) {
        new Notification("Entrada inválida: " + (err.message || "use apenas inteiros."))
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
    }
})();