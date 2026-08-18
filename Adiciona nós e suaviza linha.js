"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeCommand   = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const ChangeNodesCommand = Java.type("org.openstreetmap.josm.command.ChangeNodesCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");
const EastNorth       = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const LatLon          = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager       = Java.type("javax.swing.UIManager");

const JOptionPane     = Java.type("javax.swing.JOptionPane");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JButton         = Java.type("javax.swing.JButton");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const Box             = Java.type("javax.swing.Box");
const Dimension       = Java.type("java.awt.Dimension");
const FlowLayout      = Java.type("java.awt.FlowLayout");
const ArrayList       = Java.type("java.util.ArrayList");

function main() {
    const MAX_NOS = 4;
    const MAX_ITERACOES = 20;

    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) {
        new Notification("Nenhuma camada de edição ativa!")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    const dataset = layer.data;
    const selectedWays = dataset.getSelectedWays();
    const selectedNodes = dataset.getSelectedNodes();

    if (selectedWays.isEmpty()) {
        new Notification("Selecione pelo menos uma linha")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    const projection = ProjectionRegistry.getProjection();
    let state = {
        numInter: 0,
        iteracoes: 0,
        pilhaCmds: []
    };

    function contarTotalNos() {
        let total = 0;
        let it = selectedWays.iterator();
        while (it.hasNext()) {
            let w = it.next();
            let nodesCount = w.getNodesCount();
            total += (w.isClosed() && nodesCount > 1) ? nodesCount - 1 : nodesCount;
        }
        return total;
    }

    // --- Interface ---
    const panel = new JPanel();
    panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
    
    const info = new JLabel("Selecionados: " + selectedWays.size() + " linha(s), " + selectedNodes.size() + " nó(s)");
    info.setAlignmentX(0.5);
    panel.add(info);

    const labelTotalNos = new JLabel("Total de nós nas linhas: " + contarTotalNos());
    labelTotalNos.setAlignmentX(0.5);
    panel.add(labelTotalNos);

    panel.add(Box.createRigidArea(new Dimension(0, 10)));
    const labelNos = new JLabel("Nós entre pares: 0");
    labelNos.setAlignmentX(0.5);
    panel.add(labelNos);

    const botoesNos = new JPanel(new FlowLayout());
    const botMaisNos = new JButton("+");
    const botMenosNos = new JButton("-");
    [botMaisNos, botMenosNos].forEach(b => b.setPreferredSize(new Dimension(45, 35)));
    botoesNos.add(botMenosNos);
    botoesNos.add(botMaisNos);
    panel.add(botoesNos);

    panel.add(Box.createRigidArea(new Dimension(0, 10)));
    const labelIter = new JLabel("Iterações de suavização: 0");
    labelIter.setAlignmentX(0.5);
    panel.add(labelIter);

    const botoesIter = new JPanel(new FlowLayout());
    const botMaisIter = new JButton("+");
    const botMenosIter = new JButton("-");
    [botMaisIter, botMenosIter].forEach(b => b.setPreferredSize(new Dimension(45, 35)));
    botoesIter.add(botMenosIter);
    botoesIter.add(botMaisIter);
    panel.add(botoesIter);

    // --- Lógica de Suavização ---
    function suavizarTrecho(nodesArray, iterVal) {
        let currentNodes = nodesArray;
        let fechado = currentNodes[0] === currentNodes[currentNodes.length - 1];

        for (let it = 0; it < iterVal; it++) {
            let newNodes = [];
            for (let i = 0; i < currentNodes.length; i++) {
                if (!fechado && (i === 0 || i === currentNodes.length - 1)) {
                    newNodes.push(currentNodes[i]);
                    continue;
                }
                let prev = currentNodes[(i - 1 + currentNodes.length) % currentNodes.length].getCoor();
                let curr = currentNodes[i].getCoor();
                let next = currentNodes[(i + 1) % currentNodes.length].getCoor();
                
                let lat = (prev.lat() + curr.lat() + next.lat()) / 3.0;
                let lon = (prev.lon() + curr.lon() + next.lon()) / 3.0;
                
                let tempNode = new Node(new LatLon(lat, lon));
                newNodes.push(tempNode);
            }
            currentNodes = newNodes;
        }
        return currentNodes;
    }

    // --- Aplicação dos Comandos ---
    function aplicar(adicionarNos) {
        let comandos = new ArrayList();
        let itWays = selectedWays.iterator();

        while (itWays.hasNext()) {
            let way = itWays.next();
            let wayNodes = way.getNodes();
            let wayNodesList = [];
            for (let i = 0; i < wayNodes.size(); i++) wayNodesList.push(wayNodes.get(i));

            let startIdx = 0, endIdx = wayNodesList.length - 1;
            let selInWay = wayNodesList.filter(n => selectedNodes.contains(n));

            if (selInWay.length >= 2) {
                let idxs = selInWay.map(n => wayNodesList.indexOf(n)).sort((a,b) => a - b);
                startIdx = idxs[0];
                endIdx = idxs[idxs.length - 1];
            }

            let trecho = wayNodesList.slice(startIdx, endIdx + 1);
            if (trecho.length < 2) continue;

            let updatedTrecho = [];
            if (adicionarNos) {
                for (let i = 0; i < trecho.length - 1; i++) {
                    let n1 = trecho[i], n2 = trecho[i+1];
                    updatedTrecho.push(n1);
                    if (state.numInter > 0) {
                        let en1 = n1.getEastNorth(), en2 = n2.getEastNorth();
                        let dx = (en2.east() - en1.east()) / (state.numInter + 1);
                        let dy = (en2.north() - en1.north()) / (state.numInter + 1);
                        for (let j = 1; j <= state.numInter; j++) {
                            let en = new EastNorth(en1.east() + dx * j, en1.north() + dy * j);
                            let novo = new Node(projection.eastNorth2latlon(en));
                            comandos.add(new AddCommand(dataset, novo));
                            updatedTrecho.push(novo);
                        }
                    }
                }
                updatedTrecho.push(trecho[trecho.length - 1]);
            } else {
                updatedTrecho = trecho;
            }

            let finalWayNodes = new ArrayList();
            wayNodesList.slice(0, startIdx).forEach(n => finalWayNodes.add(n));
            updatedTrecho.forEach(n => finalWayNodes.add(n));
            wayNodesList.slice(endIdx + 1).forEach(n => finalWayNodes.add(n));
            
            comandos.add(new ChangeNodesCommand(way, finalWayNodes));

            if (state.iteracoes > 0) {
                let suavizados = suavizarTrecho(updatedTrecho, state.iteracoes);
                for (let i = 0; i < updatedTrecho.length; i++) {
                    let modNode = new Node(updatedTrecho[i]);
                    modNode.setCoor(suavizados[i].getCoor());
                    comandos.add(new ChangeCommand(dataset, updatedTrecho[i], modNode));
                }
            }
        }

        if (!comandos.isEmpty()) {
            let cmd = new SequenceCommand("Inserir e suavizar", comandos);
            UndoRedoHandler.getInstance().add(cmd);
            state.pilhaCmds.push(cmd);
        }
    }

    // --- Listeners ---
    botMaisNos.addActionListener(function() {
        if (state.numInter < MAX_NOS) {
            state.numInter++;
            labelNos.setText("Nós entre pares: " + state.numInter);
            aplicar(true);
            labelTotalNos.setText("Total de nós nas linhas: " + contarTotalNos());
        } else {
            new Notification("Limite máximo atingido (" + MAX_NOS + ")")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
    });

    botMenosNos.addActionListener(function() {
        if (state.numInter > 0) {
            state.numInter--;
            labelNos.setText("Nós entre pares: " + state.numInter);
            if (state.pilhaCmds.length > 0) {
                UndoRedoHandler.getInstance().undo();
                state.pilhaCmds.pop();
            }
            labelTotalNos.setText("Total de nós nas linhas: " + contarTotalNos());
        }
    });

    botMaisIter.addActionListener(function() {
        if (state.iteracoes < MAX_ITERACOES) {
            state.iteracoes++;
            labelIter.setText("Iterações de suavização: " + state.iteracoes);
            aplicar(false);
            labelTotalNos.setText("Total de nós nas linhas: " + contarTotalNos());
        } else {
            new Notification("Limite máximo atingido (" + MAX_ITERACOES + ")")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
    });

    botMenosIter.addActionListener(function() {
        if (state.iteracoes > 0) {
            state.iteracoes--;
            labelIter.setText("Iterações de suavização: " + state.iteracoes);
            if (state.pilhaCmds.length > 0) {
                UndoRedoHandler.getInstance().undo();
                state.pilhaCmds.pop();
            }
            labelTotalNos.setText("Total de nós nas linhas: " + contarTotalNos());
        }
    });

    let result = JOptionPane.showConfirmDialog(MainApplication.getMainFrame(), panel, "Inserir e suavizar", 
                 JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);

    if (result !== JOptionPane.OK_OPTION) {
        while (state.pilhaCmds.length > 0) {
            UndoRedoHandler.getInstance().undo();
            state.pilhaCmds.pop();
        }
        return;
    }

    // --- Notificações Finais Conforme Condição ---
    if (state.numInter === 0 && state.iteracoes === 0) {
        new Notification("Nada alterado")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
    } else if (state.numInter > 0 && state.iteracoes === 0) {
        new Notification("Nós adicionados")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    } else if (state.numInter === 0 && state.iteracoes > 0) {
        new Notification("Suavização aplicada")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    } else {
        new Notification("Nós adicionados e suavização aplicada com sucesso!")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    }
}

main();