"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const JPanel          = Java.type("javax.swing.JPanel");
const JRadioButton    = Java.type("javax.swing.JRadioButton");
const ButtonGroup     = Java.type("javax.swing.ButtonGroup");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const Box             = Java.type("javax.swing.Box");
const UIManager       = Java.type("javax.swing.UIManager");
const JOptionPane     = Java.type("javax.swing.JOptionPane");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const TitledBorder    = Java.type("javax.swing.border.TitledBorder");
const Font            = Java.type("java.awt.Font");
const Component       = Java.type("java.awt.Component");
const ArrayList       = Java.type("java.util.ArrayList");

// Utilitários

function showMessage(text, tipo = "info") {
    const icons = {
        "erro": "OptionPane.errorIcon",
        "aviso": "OptionPane.warningIcon",
        "info": "OptionPane.informationIcon"
    };
    new Notification(text)
        .setIcon(UIManager.getIcon(icons[tipo] || icons["info"]))
        .show();
}

function getSelectedWays() {
    const ds = MainApplication.getLayerManager().getEditDataSet();
    if (!ds) {
        showMessage("Nenhuma camada de edição ativa.", "erro");
        return { ds: null, ways: [] };
    }
    const selected = ds.getSelected();
    let selectedWays = [];
    const it = selected.iterator();
    while (it.hasNext()) {
        let obj = it.next();
        if (obj instanceof Way) {
            selectedWays.push(obj);
        }
    }
    if (selectedWays.length === 0) {
        showMessage("Nenhuma linha selecionada.", "aviso");
        return { ds, ways: [] };
    }
    return { ds, ways: selectedWays };
}

function countNodesByWay(selectedWays) {
    let nodeCount = new Map();
    selectedWays.forEach(way => {
        const nodes = way.getNodes();
        for (let i = 0; i < nodes.size(); i++) {
            let node = nodes.get(i);
            if (!nodeCount.has(node)) {
                nodeCount.set(node, new Set());
            }
            nodeCount.get(node).add(way);
        }
    });
    return nodeCount;
}

// Lógica de Seleção

function processSelection(shared, entresel) {
    const { ds, ways } = getSelectedWays();
    if (ways.length === 0) return;

    const nodeCountMap = countNodesByWay(ways);
    let nodesToSelect = new Set();

    if (entresel && ways.length < 2) {
        showMessage("Selecione ao menos dois objetos para o modo 'Entre selecionados'.", "aviso");
        return;
    }

    if (entresel) {
        // Analisa a relação apenas entre os objetos que você clicou
        nodeCountMap.forEach((waysSet, node) => {
            const count = waysSet.size;
            if (shared && count > 1) nodesToSelect.add(node);
            else if (!shared && count === 1) nodesToSelect.add(node);
        });
    } else {
        // Analisa a relação do nó com TODO o mapa (referrers)
        ways.forEach(way => {
            const nodes = way.getNodes();
            for (let i = 0; i < nodes.size(); i++) {
                let node = nodes.get(i);
                const refCount = node.getReferrers().size();
                if (shared && refCount > 1) nodesToSelect.add(node);
                else if (!shared && refCount === 1) nodesToSelect.add(node);
            }
        });
    }

    if (nodesToSelect.size === 0) {
        showMessage("Nenhum nó correspondente encontrado.", "aviso");
        return;
    }

    const finalSelection = new ArrayList();
    nodesToSelect.forEach(n => finalSelection.add(n));
    ds.setSelected(finalSelection);
    showMessage(nodesToSelect.size + " nós selecionados!");
}

// Interface Principal

(function main() {
    const { ways } = getSelectedWays();
    if (ways.length === 0) return;

    const mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(5, 10, 10, 5));

    const boldFont = new Font("Dialog", Font.BOLD, 12);

    // --- Seção: Tipo ---
    const panelTipo = new JPanel();
    panelTipo.setLayout(new BoxLayout(panelTipo, BoxLayout.Y_AXIS));
    panelTipo.setBorder(BorderFactory.createTitledBorder(
        BorderFactory.createEtchedBorder(), "Tipo", TitledBorder.LEFT, TitledBorder.TOP, boldFont
    ));

    const rbShared = new JRadioButton("Nós compartilhados", true);
    const rbNotShared = new JRadioButton("Nós não compartilhados");
    const groupTipo = new ButtonGroup();
    groupTipo.add(rbShared); groupTipo.add(rbNotShared);
    
    rbShared.setAlignmentX(Component.LEFT_ALIGNMENT);
    rbNotShared.setAlignmentX(Component.LEFT_ALIGNMENT);
    panelTipo.add(rbShared); panelTipo.add(rbNotShared);

    // --- Seção: Modo ---
    const panelModo = new JPanel();
    panelModo.setLayout(new BoxLayout(panelModo, BoxLayout.Y_AXIS));
    panelModo.setBorder(BorderFactory.createTitledBorder(
        BorderFactory.createEtchedBorder(), "Modo de análise", TitledBorder.LEFT, TitledBorder.TOP, boldFont
    ));

    const optEntre = new JRadioButton("Entre selecionados", true);
    const optApenas = new JRadioButton("Apenas selecionado");
    const groupModo = new ButtonGroup();
    groupModo.add(optEntre); groupModo.add(optApenas);

    optEntre.setAlignmentX(Component.LEFT_ALIGNMENT);
    optApenas.setAlignmentX(Component.LEFT_ALIGNMENT);
    panelModo.add(optEntre); panelModo.add(optApenas);

    mainPanel.add(panelTipo);
    mainPanel.add(Box.createVerticalStrut(10));
    mainPanel.add(panelModo);

    const result = JOptionPane.showConfirmDialog(
        MainApplication.getMainFrame(),
        mainPanel,
        "Selecionar Nós por Conectividade",
        JOptionPane.OK_CANCEL_OPTION,
        JOptionPane.PLAIN_MESSAGE
    );

    if (result === JOptionPane.OK_OPTION) {
        processSelection(rbShared.isSelected(), optEntre.isSelected());
    }
})();