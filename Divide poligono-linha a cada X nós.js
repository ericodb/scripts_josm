"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeCommand   = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager       = Java.type("javax.swing.UIManager");

const JOptionPane        = Java.type("javax.swing.JOptionPane");
const JPanel             = Java.type("javax.swing.JPanel");
const JLabel             = Java.type("javax.swing.JLabel");
const JSpinner           = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const GridLayout         = Java.type("java.awt.GridLayout");
const ArrayList          = Java.type("java.util.ArrayList");

function dividirLinhaPorNos() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    const ds = layer.data;
    const selected = ds.getSelectedWays();

    if (selected.size() !== 1) {
        new Notification("Selecione uma linha ou polígono para dividir!")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    const way = selected.iterator().next();
    const nodes = way.getNodes();
    let totalNodes = nodes.size();
    
    const ehFechado = way.isClosed();
    const nósExibicao = ehFechado ? totalNodes - 1 : totalNodes;

    // Painel de Configuração
    const panel = new JPanel(new GridLayout(3, 1));
    panel.add(new JLabel("A linha selecionada contém " + nósExibicao + " nós."));
    const spinner = new JSpinner(new SpinnerNumberModel(100, 2, 1900, 100));
    panel.add(spinner);
    const infoMsg = "<html><i><span style='color:red;'>ATENÇÃO! Se a linha é membro de uma relação,<br>os novos membros devem ser adicionados manualmente.</span></i></html>";
    panel.add(new JLabel(infoMsg));

    const result = JOptionPane.showConfirmDialog(
        MainApplication.getMainFrame(), 
        panel, 
        "Dividir linha a cada X nós",
        JOptionPane.OK_CANCEL_OPTION, 
        JOptionPane.PLAIN_MESSAGE
    );

    if (result === JOptionPane.OK_OPTION) {
        const step = spinner.getValue();

        if (step >= nósExibicao && !ehFechado) {
            new Notification("O valor escolhido é maior ou igual ao número de nós. Nada será dividido.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const newWays = [];
        const nodesList = [];
        for (let i = 0; i < totalNodes; i++) {
            nodesList.push(nodes.get(i));
        }

        // Lógica de fatiamento
        for (let i = 0; i < totalNodes - 1; i += step) {
            let partNodes = nodesList.slice(i, i + step + 1);
            
            // Se o segmento ficou com apenas 1 nó (pode acontecer no final), ignora
            if (partNodes.length < 2) continue;

            let javaNodes = new ArrayList();
            partNodes.forEach(n => javaNodes.add(n));

            let newPartWay = new Way();
            newPartWay.setNodes(javaNodes);
            newPartWay.setKeys(way.getKeys());
            newWays.push(newPartWay);
        }

        if (newWays.length <= 1) {
            new Notification("Nenhum segmento foi criado (valor do step maior que a linha).")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        } else {
            const cmds = new ArrayList();

            // Atualiza a way original (preserva ID) com o primeiro segmento
            let wayMod = new Way(way);
            wayMod.setNodes(newWays[0].getNodes());
            cmds.add(new ChangeCommand(way, wayMod));

            // Adiciona os demais segmentos como novas ways
            for (let i = 1; i < newWays.length; i++) {
                cmds.add(new AddCommand(ds, newWays[i]));
            }

            UndoRedoHandler.getInstance().add(new SequenceCommand("Dividir linha em segmentos", cmds));

            new Notification("Linha dividida em " + newWays.length + " segmentos.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    }
}

dividirLinhaPorNos();