"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const DeleteCommand   = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const LatLon          = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager       = Java.type("javax.swing.UIManager");

const JOptionPane        = Java.type("javax.swing.JOptionPane");
const JPanel             = Java.type("javax.swing.JPanel");
const JLabel             = Java.type("javax.swing.JLabel");
const JSpinner           = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const GridBagLayout      = Java.type("java.awt.GridBagLayout");
const GridBagConstraints = Java.type("java.awt.GridBagConstraints");
const Insets             = Java.type("java.awt.Insets");
const Dimension          = Java.type("java.awt.Dimension");
const ArrayList          = Java.type("java.util.ArrayList");

function criarEstrela() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon"))
            .show();
        return;
    }

    const dataset = layer.data;
    const selecionados = dataset.getSelectedWays();

    if (selecionados.size() !== 1) {
        new Notification("Selecione uma linha com dois nós.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
            .show();
        return;
    }

    const linha = selecionados.iterator().next();
    const linhaNos = linha.getNodes();

    if (linhaNos.size() !== 2) {
        new Notification("A linha deve conter exatamente dois nós.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
            .show();
        return;
    }

    const centro = linhaNos.get(0);
    const ponta = linhaNos.get(1);

    const cx = centro.getCoor().lat();
    const cy = centro.getCoor().lon();
    const px = ponta.getCoor().lat();
    const py = ponta.getCoor().lon();

    // Cálculos Geodésicos (Métrica simples)
    const latRad = (cx + px) / 2 * Math.PI / 180.0;
    const dx = (py - cy) * 111320 * Math.cos(latRad);
    const dy = (px - cx) * 111320;
    const raio = Math.sqrt(dx * dx + dy * dy);

    // Calcular ângulo de orientação da linha
    const deltaX = (py - cy) * Math.cos(latRad);
    const deltaY = (px - cx);
    const anguloRot = Math.atan2(deltaY, deltaX);

    // Interface Gráfica
    const panel = new JPanel(new GridBagLayout());
    const gbc = new GridBagConstraints();
    gbc.insets = new Insets(5, 5, 5, 5);

    gbc.gridx = 0; gbc.gridy = 0;
    gbc.anchor = GridBagConstraints.EAST;
    panel.add(new JLabel("Número de pontas:"), gbc);

    gbc.gridx = 1;
    const spinnerModel = new SpinnerNumberModel(5, 3, 25, 1);
    const spinner = new JSpinner(spinnerModel);
    spinner.setPreferredSize(new Dimension(80, 25));
    panel.add(spinner, gbc);

    const resultado = JOptionPane.showConfirmDialog(
        MainApplication.getMainFrame(), 
        panel, 
        "Criar Estrela", 
        JOptionPane.OK_CANCEL_OPTION,
        JOptionPane.PLAIN_MESSAGE
    );

    if (resultado !== JOptionPane.OK_OPTION) return;

    const numPontas = spinner.getValue();
    const anguloBase = (2 * Math.PI) / (numPontas * 2);
    const comandos = new ArrayList();
    const novosNos = new ArrayList();

    for (let i = 0; i < numPontas * 2; i++) {
        let angulo = i * anguloBase;
        let r = (i % 2 === 0) ? raio : raio / 2.5;

        let dxLocal = r * Math.cos(angulo);
        let dyLocal = r * Math.sin(angulo);

        // Aplica rotação conforme a orientação da linha original
        let dxRot = dxLocal * Math.cos(anguloRot) - dyLocal * Math.sin(anguloRot);
        let dyRot = dxLocal * Math.sin(anguloRot) + dyLocal * Math.cos(anguloRot);

        let dlat = dyRot / 111320.0;
        let dlon = dxRot / (111320.0 * Math.cos(cx * Math.PI / 180.0));
        
        let node = new Node(new LatLon(cx + dlat, cy + dlon));
        comandos.add(new AddCommand(dataset, node));
        novosNos.add(node);
    }

    // Fechar a estrela
    novosNos.add(novosNos.get(0));

    const estrela = new Way();
    estrela.setNodes(novosNos);
    comandos.add(new AddCommand(dataset, estrela));

    // Remover a linha guia original e seus nós
    comandos.add(new DeleteCommand(dataset, linha));
    let itNos = linhaNos.iterator();
    while (itNos.hasNext()) {
        comandos.add(new DeleteCommand(dataset, itNos.next()));
    }

    UndoRedoHandler.getInstance().add(new SequenceCommand("Criar estrela", comandos));

    new Notification("Estrela criada com sucesso.")
        .setIcon(UIManager.getIcon("OptionPane.informationIcon"))
        .show();
}

criarEstrela();