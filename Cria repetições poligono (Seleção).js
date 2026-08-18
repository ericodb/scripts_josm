"use strict";

import { addResetCallback } from 'josm/context';

// Imports Java
const MainApplication        = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification            = Java.type("org.openstreetmap.josm.gui.Notification");
const Node                    = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way                     = Java.type("org.openstreetmap.josm.data.osm.Way");
const SequenceCommand         = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const AddCommand              = Java.type("org.openstreetmap.josm.command.AddCommand");
const ProjectionRegistry      = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const EastNorth               = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const ImageProvider        = Java.type("org.openstreetmap.josm.tools.ImageProvider");
const UndoRedoHandler         = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");

const JDialog        = Java.type("javax.swing.JDialog");
const JPanel         = Java.type("javax.swing.JPanel");
const JLabel         = Java.type("javax.swing.JLabel");
const JButton        = Java.type("javax.swing.JButton");
const JSpinner       = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const JRadioButton   = Java.type("javax.swing.JRadioButton");
const ButtonGroup    = Java.type("javax.swing.ButtonGroup");
const BoxLayout      = Java.type("javax.swing.BoxLayout");
const Box            = Java.type("javax.swing.Box");
const BorderFactory  = Java.type("javax.swing.BorderFactory");
const UIManager      = Java.type("javax.swing.UIManager");
const Dimension      = Java.type("java.awt.Dimension");
const FlowLayout     = Java.type("java.awt.FlowLayout");
const BorderLayout   = Java.type("java.awt.BorderLayout");
const Component      = Java.type("java.awt.Component");
const ArrayList      = Java.type("java.util.ArrayList");
const SwingUtilities  = Java.type("javax.swing.SwingUtilities");
const WindowAdapter   = Java.extend(Java.type("java.awt.event.WindowAdapter"));

// LayerChangeListener criado no topo
const LayerChangeListener = Java.extend(
    Java.type("org.openstreetmap.josm.gui.layer.LayerManager$LayerChangeListener"), {
        layerAdded:        function (_e) {},
        layerOrderChanged: function (_e) {},
        layerRemoving:     function (e) {
            // Fecha se a camada de dados da sessão for removida
            try {
                const removed = e.getRemovedLayer();
                if (removed && removed.data && removed.data === sourceDs) {
                    SwingUtilities.invokeLater(function () {
                        if (dialog !== null) { dialog.dispose(); dialog = null; }
                        clean_up();
                        new Notification("Camada removida. Diálogo fechado.")
                            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                    });
                }
            } catch (ex) {}
        }
    }
);
let layerListener = null;

// Estado global da sessão
let dialog         = null;   // JDialog não-modal
let sourceDs       = null;   // DataSet da camada na abertura
let totalAplicados = 0;      // total de polígonos criados na sessão
let totalComandos  = 0;      // total de SequenceCommands (1 por Aplicar) para undo

// Limpeza de listeners
function clean_up() {
    if (layerListener !== null) {
        try { MainApplication.getLayerManager().removeLayerChangeListener(layerListener); }
        catch (e) {}
        layerListener = null;
    }
    sourceDs       = null;
    totalAplicados = 0;
    totalComandos  = 0;
}

// Lógica de cópia
// Retorna o número de polígonos criados, ou 0 em caso de erro/cancelamento.
function executarCopia(spinner, rbLeft) {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return 0;
    }

    // Segurança: bloqueia se a camada mudou desde a abertura do diálogo
    if (sourceDs !== null && layer.data !== sourceDs) {
        new Notification("A camada foi alterada. Feche e reabra o script.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return 0;
    }

    // Lê seleção atual (permite nova seleção a cada Aplicar)
    const selectedWays = layer.data.getSelectedWays();
    const ways = [];
    const it = selectedWays.iterator();
    while (it.hasNext()) ways.push(it.next());

    if (ways.length !== 2) {
        new Notification("Selecione exatamente dois polígonos para definir o vetor de cópia.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return 0;
    }
    if (!ways[0].isClosed() || !ways[1].isClosed()) {
        new Notification("Ambos os objetos devem ser polígonos fechados.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return 0;
    }

    const num  = parseInt(String(spinner.getValue()), 10);
    const side = rbLeft.isSelected() ? "esquerda" : "direita";

    const proj = ProjectionRegistry.getProjection();
    const ds   = layer.data;
    const cmds = new ArrayList();

    const en1 = ways[0].getNode(0).getEastNorth();
    const en2 = ways[1].getNode(0).getEastNorth();
    const dx  = en2.east()  - en1.east();
    const dy  = en2.north() - en1.north();

    let sourcePoly, baseDx, baseDy;
    if (side === "esquerda") {
        sourcePoly = ways[0]; baseDx = -dx; baseDy = -dy;
    } else {
        sourcePoly = ways[1]; baseDx =  dx; baseDy =  dy;
    }

    for (let i = 1; i <= num; i++) {
        const cdx = baseDx * i;
        const cdy = baseDy * i;

        const newNodes     = new ArrayList();
        const originalNodes = sourcePoly.getNodes();
        const nodeCount    = originalNodes.size();

        for (let j = 0; j < nodeCount; j++) {
            const n = originalNodes.get(j);
            // Fecha o polígono reutilizando o primeiro nó novo
            if (j === nodeCount - 1 && n === originalNodes.get(0)) {
                newNodes.add(newNodes.get(0));
                continue;
            }
            const en    = n.getEastNorth();
            const newEn = new EastNorth(en.east() + cdx, en.north() + cdy);
            const newNode = new Node(proj.eastNorth2latlon(newEn));
            cmds.add(new AddCommand(ds, newNode));
            newNodes.add(newNode);
        }

        const newWay = new Way();
        newWay.setNodes(newNodes);
        newWay.setKeys(sourcePoly.getKeys());
        cmds.add(new AddCommand(ds, newWay));
    }

    UndoRedoHandler.getInstance().add(
        new SequenceCommand("Cópia em Série (" + num + ")", cmds));

    // Limpa seleção para forçar nova seleção no próximo Aplicar
    layer.data.clearSelection();

    return num;
}

// Ponto de entrada
function copyPolygons() {
    // Garante que não abre dois diálogos simultâneos
    if (dialog !== null) {
        dialog.toFront();
        return;
    }

    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    // Fixa o DataSet da sessão e registra listener de camada
    sourceDs       = layer.data;
    totalAplicados = 0;
    layerListener  = new LayerChangeListener();
    MainApplication.getLayerManager().addLayerChangeListener(layerListener);

    // Diálogo NÃO-MODAL
    dialog = new JDialog(MainApplication.getMainFrame(),
                         "Cópia em Série", false); // false = não-modal
    dialog.setDefaultCloseOperation(2);

    const panel = new JPanel();
    panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
    panel.setBorder(BorderFactory.createEmptyBorder(15, 20, 10, 20));

    // Quantidade
    const lbl = new JLabel("Quantidade de cópias:");
    lbl.setAlignmentX(Component.CENTER_ALIGNMENT);
    const spinner = new JSpinner(new SpinnerNumberModel(1, 1, 100, 1));
    spinner.setMaximumSize(new Dimension(80, 35));
    spinner.setAlignmentX(Component.CENTER_ALIGNMENT);

    // Direção
    const rbLeft  = new JRadioButton("Esquerda");
    const rbRight = new JRadioButton("Direita", true);
    const bg = new ButtonGroup();
    bg.add(rbLeft); bg.add(rbRight);
    [rbLeft, rbRight].forEach(function(r) {
        r.setAlignmentX(Component.CENTER_ALIGNMENT);
    });

    panel.add(lbl);
    panel.add(Box.createVerticalStrut(5));
    panel.add(spinner);
    panel.add(Box.createVerticalStrut(15));
    panel.add(rbLeft);
    panel.add(rbRight);
    panel.add(Box.createVerticalStrut(10));

    // Botões
    // Aplicar — executa sem notificar e sem fechar
    const btnAplicar = new JButton("Aplicar", ImageProvider.getIfAvailable("apply"));
    btnAplicar.setAlignmentX(Component.CENTER_ALIGNMENT);
    panel.add(btnAplicar);
    panel.add(Box.createVerticalStrut(6));

    const btnRowPanel = new JPanel(new FlowLayout(FlowLayout.CENTER, 15, 8));
    const btnOk  = new JButton("OK",       UIManager.getIcon("OptionPane.yesIcon"));
    const btnCan = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
    btnRowPanel.add(btnOk);
    btnRowPanel.add(btnCan);

    dialog.add(panel,       BorderLayout.CENTER);
    dialog.add(btnRowPanel, BorderLayout.SOUTH);

    // Listeners
    // Aplicar: copia, limpa seleção, não fecha nem notifica
    btnAplicar.addActionListener(function (_e) {
        const n = executarCopia(spinner, rbLeft);
        if (n > 0) { totalAplicados += n; totalComandos++; }
    });

    // OK: fecha e notifica o total já aplicado
    btnOk.addActionListener(function (_e) {
        const total = totalAplicados;
        dialog.dispose();
        dialog = null;
        clean_up();

        if (total > 0) {
            new Notification(total + " polígono(s) copiado(s) no total.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Nenhuma cópia foi aplicada.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
    });

    // Cancelar: desfaz todas as operações da sessão e fecha
    btnCan.addActionListener(function (_e) {
        const total = totalAplicados;
        const cmds  = totalComandos;
        dialog.dispose();
        dialog = null;
        clean_up();

        if (cmds > 0) {
            // 1 SequenceCommand por Aplicar — desfaz cada um
            for (let i = 0; i < cmds; i++) {
                try { UndoRedoHandler.getInstance().undo(); } catch (e) { break; }
            }
        }
        new Notification("Operação cancelada. Alterações desfeitas.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    });

    // Fechar via X: limpa estado mas sem desfazer
    dialog.addWindowListener(new WindowAdapter({
        windowClosed: function() {
            dialog = null;
            clean_up();
        }
    }));

    dialog.pack();
    dialog.setSize(new Dimension(275, dialog.getPreferredSize().height));
    dialog.setResizable(false);
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
}

// Reset Context: fecha diálogo e limpa estado quando o plugin faz reset
addResetCallback(function () {
    if (dialog !== null) { dialog.dispose(); dialog = null; }
    clean_up();
});

copyPolygons();