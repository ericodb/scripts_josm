"use strict";

// --- IMPORTAÇÕES ---
const Way = Java.type("org.openstreetmap.josm.data.osm.Way");
const Node = Java.type("org.openstreetmap.josm.data.osm.Node");
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification = Java.type("org.openstreetmap.josm.gui.Notification");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const ChangeCommand = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const DeleteCommand = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const AddCommand = Java.type("org.openstreetmap.josm.command.AddCommand");
const JOptionPane = Java.type("javax.swing.JOptionPane");
const UIManager = Java.type("javax.swing.UIManager");
const JPanel = Java.type("javax.swing.JPanel");
const JRadioButton = Java.type("javax.swing.JRadioButton");
const ButtonGroup = Java.type("javax.swing.ButtonGroup");
const GridLayout = Java.type("java.awt.GridLayout");
const ArrayList = Java.type("java.util.ArrayList");

(function() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    const dataset = layer ? layer.data : null;

    if (!dataset) {
        new Notification("Nenhuma camada de edição ativa.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    // --- AUXILIARES ---
    function getCentroid(way) {
        let nodes = way.getNodes();
        if (nodes.isEmpty()) return { lon: 0, lat: 0 };
        let lonSum = 0, latSum = 0;
        for (let i = 0; i < nodes.size(); i++) {
            let coor = nodes.get(i).getCoor();
            lonSum += coor.lon(); latSum += coor.lat();
        }
        return { lon: lonSum / nodes.size(), lat: latSum / nodes.size() };
    }

    function calcularDistancia(c1, c2) {
        return Math.sqrt(Math.pow(c1.lon - c2.lon, 2) + Math.pow(c1.lat - c2.lat, 2));
    }

    function getCleanNodes(way) {
        let nodes = [];
        let jNodes = way.getNodes();
        for (let i = 0; i < jNodes.size(); i++) nodes.push(jNodes.get(i));
        if (way.isClosed() && nodes.length > 0 && nodes[0] === nodes[nodes.length - 1]) return nodes.slice(0, -1);
        return nodes;
    }

    function podeDeletar(node) {
        return node && !node.isDeleted() && node.getDataSet() !== null;
    }

    function safeDeleteCheckList(node, wayList, safeSet) {
        if (safeSet.has(node)) return [false, false];
        let isSafe = true;
        if (node.getDataSet() !== null) {
            let referrers = node.getReferrers();
            for (let i = 0; i < referrers.size(); i++) {
                let ref = referrers.get(i);
                // Um nó só é seguro deletar se TODAS as geometrias que o usam estiverem na lista de deleção
                if (wayList.indexOf(ref) === -1) {
                    isSafe = false; break;
                }
            }
        }
        if (isSafe) { safeSet.add(node); return [true, node.getUniqueId() > 0]; }
        return [false, false];
    }

    // Transferir tags
    function transferirTags(wEst, antiga, nova) {
        const antigaTags = antiga.getKeys();
        const hasAnyTag  = antigaTags && Object.keys(antigaTags).length > 0;
        const novaKeys   = nova.getKeys();

        if (!hasAnyTag) {
            for (const k in novaKeys) wEst.put(k, novaKeys[k]);
        } else {
            for (const k in novaKeys) {
                if (antiga.hasKey(k)) wEst.put(k, novaKeys[k]);
            }
        }
    }

    // --- MODO 1: N-PARA-N ---
    function substituirVarias() {
        let ways = dataset.getSelectedWays();
        let antigas = [], novas = [];
        let it = ways.iterator();
        while(it.hasNext()){
            let w = it.next();
            if (w.isNew()) novas.push(w); else antigas.push(w);
        }

        let pares = [], usadas = new Set();
        antigas.forEach(a => {
            let c1 = getCentroid(a), melhor = null, menorDist = Infinity;
            novas.forEach(n => {
                if (usadas.has(n)) return;
                let dist = calcularDistancia(c1, getCentroid(n));
                if (dist < menorDist) { melhor = n; menorDist = dist; }
            });
            if (melhor) { usadas.add(melhor); pares.push([a, melhor]); }
        });

        if (pares.length === 0) {
            new Notification("Nenhum par válido encontrado para substituição.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        let cmds = new ArrayList();
        let safeOld = new Set(), safeNew = new Set();
        let stats = { subs: 0, nos: 0, remOld: 0, remNew: 0 };
        let novasDeletadas = [];

        pares.forEach(par => {
            let [antiga, nova] = par;
            novasDeletadas.push(nova);
            let nNodes = getCleanNodes(nova), aNodes = getCleanNodes(antiga);
            let minLen = Math.min(nNodes.length, aNodes.length);
            let novosNosWay = [];

            for (let i = 0; i < minLen; i++) {
                let nEst = new Node(aNodes[i]);
                nEst.setCoor(nNodes[i].getCoor());
                cmds.add(new ChangeCommand(aNodes[i], nEst));
                novosNosWay.push(aNodes[i]);
                stats.nos++;
            }
            for (let i = minLen; i < nNodes.length; i++) {
                let nAdd = new Node(nNodes[i].getCoor());
                cmds.add(new AddCommand(dataset, nAdd));
                novosNosWay.push(nAdd);
            }
            if (antiga.isClosed() && novosNosWay.length > 0) novosNosWay.push(novosNosWay[0]);

            let wEst = new Way(antiga);
            wEst.setNodes(novosNosWay);
            let keys = nova.getKeys();
            for (let k in keys) { if (!wEst.hasKey(k)) wEst.put(k, keys[k]); }
            
            cmds.add(new ChangeCommand(antiga, wEst));
            cmds.add(new DeleteCommand(dataset, nova));
            stats.subs++;

            // Deletar nós excedentes da antiga (que não foram movidos)
            for (let i = minLen; i < aNodes.length; i++) {
                let [safe, oldId] = safeDeleteCheckList(aNodes[i], [antiga], safeOld);
                if (safe) { if (oldId) stats.remOld++; cmds.add(new DeleteCommand(dataset, aNodes[i])); }
            }
        });

        // Limpeza de nós das novas: APENAS das que foram substituídas
        let nodesCheckNew = new Set();
        novasDeletadas.forEach(nw => nw.getNodes().forEach(n => nodesCheckNew.add(n)));
        nodesCheckNew.forEach(n => {
            let [safe, oldId] = safeDeleteCheckList(n, novasDeletadas, safeNew);
            if (safe && podeDeletar(n)) { if (oldId) stats.remNew++; cmds.add(new DeleteCommand(dataset, n)); }
        });

        if (!cmds.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Substituir multiplas geometrias", cmds));
            new Notification("Substituicoes (Modo 1) concluídas.\n"
                + "Linhas substituídas: " + stats.subs + "\n"
                + "Nós substituídos: " + stats.nos + "\n"
                + "Nós antigos removidos: " + stats.remOld + "\n"
                + "Nós novos removidos: " + stats.remNew).setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    }

    // --- MODO 2: 1-PARA-N ---
    function substituirDiferenca() {
        let ways = dataset.getSelectedWays();
        let antigas = [], novas = [];
        let it = ways.iterator();
        while(it.hasNext()){
            let w = it.next();
            if (w.isNew()) novas.push(w); else antigas.push(w);
        }

        let antiga = antigas[0], cAnt = getCentroid(antiga);
        novas.sort((a, b) => calcularDistancia(cAnt, getCentroid(a)) - calcularDistancia(cAnt, getCentroid(b)));

        let cmds = new ArrayList();
        let stats = { waysNovas: novas.length - 1, nos: 0, remOld: 0, remNew: 0 };
        let safeOld = new Set(), safeNew = new Set();
        
        let aNodesAll = getCleanNodes(antiga);
        let nPrincipal = novas[0], nPrinNodes = getCleanNodes(nPrincipal);
        let minPrin = Math.min(aNodesAll.length, nPrinNodes.length);
        let nosParaAntiga = [];

        for (let i = 0; i < minPrin; i++) {
            let nEst = new Node(aNodesAll[i]);
            nEst.setCoor(nPrinNodes[i].getCoor());
            cmds.add(new ChangeCommand(aNodesAll[i], nEst));
            nosParaAntiga.push(aNodesAll[i]);
            stats.nos++;
        }
        for (let i = minPrin; i < nPrinNodes.length; i++) {
            let nAdd = new Node(nPrinNodes[i].getCoor());
            cmds.add(new AddCommand(dataset, nAdd));
            nosParaAntiga.push(nAdd);
        }
        if (antiga.isClosed()) nosParaAntiga.push(nosParaAntiga[0]);
        let wEstPrin = new Way(antiga); wEstPrin.setNodes(nosParaAntiga);
        cmds.add(new ChangeCommand(antiga, wEstPrin));
        cmds.add(new DeleteCommand(dataset, nPrincipal));

        let nosExcedentes = aNodesAll.slice(minPrin);
        for (let i = 1; i < novas.length; i++) {
            let nExcNodes = getCleanNodes(novas[i]);
            let minExc = Math.min(nosExcedentes.length, nExcNodes.length);
            let nosParaWayNova = [];

            for (let j = 0; j < minExc; j++) {
                let nTrans = nosExcedentes.shift();
                let nEst = new Node(nTrans);
                nEst.setCoor(nExcNodes[j].getCoor());
                cmds.add(new ChangeCommand(nTrans, nEst));
                nosParaWayNova.push(nTrans);
                stats.nos++;
            }
            for (let j = minExc; j < nExcNodes.length; j++) {
                let nAdd = new Node(nExcNodes[j].getCoor());
                cmds.add(new AddCommand(dataset, nAdd));
                nosParaWayNova.push(nAdd);
            }
            if (novas[i].isClosed()) nosParaWayNova.push(nosParaWayNova[0]);
            let wEstExc = new Way(novas[i]); wEstExc.setNodes(nosParaWayNova);
            cmds.add(new ChangeCommand(novas[i], wEstExc));
        }

        let nodesCheckNew = new Set();
        novas.forEach(nw => nw.getNodes().forEach(n => nodesCheckNew.add(n)));
        nodesCheckNew.forEach(n => {
            let [safe, oldId] = safeDeleteCheckList(n, novas, safeNew);
            if (safe && podeDeletar(n)) { if (oldId) stats.remNew++; cmds.add(new DeleteCommand(dataset, n)); }
        });

        nosExcedentes.forEach(n => {
            let [safe, oldId] = safeDeleteCheckList(n, [antiga], safeOld);
            if (safe && podeDeletar(n)) { if (oldId) stats.remOld++; cmds.add(new DeleteCommand(dataset, n)); }
        });

        if (!cmds.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Substituir 1-N (com distribuicao)", cmds));
            
            let cleanupCmds = new ArrayList();
            let allNodes = dataset.getNodes().iterator();
            while(allNodes.hasNext()){
                let n = allNodes.next();
                if (n.isNew() && n.getReferrers().isEmpty() && podeDeletar(n)) cleanupCmds.add(new DeleteCommand(dataset, n));
            }
            if (!cleanupCmds.isEmpty()) UndoRedoHandler.getInstance().add(new SequenceCommand("Limpeza de nós órfãos", cleanupCmds));

            new Notification("Substituição (Modo 2) concluída.\n"
                + "Ways selecionadas sem ID: " + stats.waysNovas + "\n"
                + "Nós substituídos/movidos: " + stats.nos + "\n"
                + "Nós antigos (não usados) removidos: " + stats.remOld + "\n"
                + "Nós novos (way principal) removidos: " + stats.remNew).setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    }

    // --- MAIN ---
    const waysSel = dataset.getSelectedWays();
    let hasOld = false, hasNew = false;
    let it = waysSel.iterator();
    while(it.hasNext()){ let w = it.next(); if (w.isNew()) hasNew = true; else hasOld = true; }

    if (!hasOld || !hasNew) {
        new Notification("Selecione geometrias com ID e novas.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    const panel = new JPanel(new GridLayout(0, 1));
    const rb1 = new JRadioButton("Modo 1: Múltiplos pares (N-para-N)", true);
    const rb2 = new JRadioButton("Modo 2: Distribuir IDs (1-para-N)");
    const group = new ButtonGroup(); group.add(rb1); group.add(rb2);
    panel.add(rb1); panel.add(rb2);

    const res = JOptionPane.showConfirmDialog(MainApplication.getMainFrame(), panel, "Escolha o Modo", JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
    if (res === JOptionPane.OK_OPTION) {
        if (rb1.isSelected()) substituirVarias(); else substituirDiferenca();
    }
})();