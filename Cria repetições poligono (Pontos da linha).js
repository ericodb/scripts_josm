"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const Node            = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const AddCommand      = Java.type("org.openstreetmap.josm.command.AddCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const LatLon          = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager       = Java.type("javax.swing.UIManager");
const ArrayList       = Java.type("java.util.ArrayList");

// Constante geodésica para cálculos métricos rápidos
const METERS_PER_DEGREE = 111320.0;

function vetorEmMetros(n1, n2) {
    let c1 = n1.getCoor();
    let c2 = n2.getCoor();
    let latRad = (c1.lat() + c2.lat()) / 2 * Math.PI / 180.0;
    let dx = (c2.lon() - c1.lon()) * METERS_PER_DEGREE * Math.cos(latRad);
    let dy = (c2.lat() - c1.lat()) * METERS_PER_DEGREE;
    return { dx: dx, dy: dy };
}

function rotacionarEMover(origNodes, nRef1, nRef2, dRef1, dRef2, rotacionar) {
    let anguloRot = 0;
    if (rotacionar) {
        let vBase = vetorEmMetros(nRef1, nRef2);
        let angBase = Math.atan2(vBase.dy, vBase.dx);
        
        let vDest = vetorEmMetros(dRef1, dRef2);
        let angDest = Math.atan2(vDest.dy, vDest.dx);
        
        anguloRot = angDest - angBase;
    }

    let bLat = nRef1.getCoor().lat();
    let bLon = nRef1.getCoor().lon();
    let dLat = dRef1.getCoor().lat();
    let dLon = dRef1.getCoor().lon();

    let novosNos = [];
    let nodesArray = origNodes.toArray();

    for (let i = 0; i < nodesArray.length; i++) {
        let n = nodesArray[i];
        let lat = n.getCoor().lat();
        let lon = n.getCoor().lon();

        // Offset relativo ao nó de referência da fonte, em metros
        let latMidSrc = (lat + bLat) / 2 * Math.PI / 180.0;
        let dx = (lon - bLon) * METERS_PER_DEGREE * Math.cos(latMidSrc);
        let dy = (lat - bLat) * METERS_PER_DEGREE;

        let dxr = dx * Math.cos(anguloRot) - dy * Math.sin(anguloRot);
        let dyr = dx * Math.sin(anguloRot) + dy * Math.cos(anguloRot);

        // Reconstrói coordenada no destino usando a latitude de destino para o cos()
        let newLat = dLat + (dyr / METERS_PER_DEGREE);
        let newLon = dLon + (dxr / (METERS_PER_DEGREE * Math.cos(dLat * Math.PI / 180.0)));
        
        novosNos.push(new Node(new LatLon(newLat, newLon)));
    }
    return novosNos;
}

function stampAlongLine() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    if (!layer || !layer.data) return;

    const selecionados = layer.data.getSelected();
    let ways = [], nodes = [];
    
    let it = selecionados.iterator();
    while (it.hasNext()) {
        let obj = it.next();
        if (obj instanceof Way) ways.push(obj);
        else if (obj instanceof Node) nodes.push(obj);
    }

    if (ways.length !== 2) {
        new Notification("Selecione:\n1. Um Polígono Fechado\n2. Uma Linha (Caminho)\n3. Nós do polígono para orientação")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    const poligono = ways[0].isClosed() ? ways[0] : ways[1];
    const linha = (poligono === ways[0]) ? ways[1] : ways[0];

    if (!poligono.isClosed() || linha.isClosed()) {
        new Notification("Erro: Selecione um polígono fechado e uma linha aberta.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    // Variáveis mutáveis													   
    let rotacionar = true;
    let nRef1 = null, nRef2 = null;

    if (nodes.length === 2) {
        nRef1 = nodes[0]; 
        nRef2 = nodes[1];
        if (!poligono.getNodes().contains(nRef1) || !poligono.getNodes().contains(nRef2)) {
            new Notification("Os nós de referência devem pertencer ao polígono.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }
    } else if (nodes.length === 1) {
        nRef1 = nodes[0];
        nRef2 = nodes[0];
        rotacionar = false;
        if (!poligono.getNodes().contains(nRef1)) {
            new Notification("O nó de referência deve pertencer ao polígono.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }
    } else {
        new Notification("Selecione 1 ou 2 nós do polígono como pontos de referência.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    const comandos = new ArrayList();
    const linhaNos = linha.getNodes();

    if (linhaNos.size() < 2) {
        new Notification("A linha deve ter pelo menos 2 nós para criar segmentos.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    for (let i = 0; i < linhaNos.size() - 1; i++) {
        let origem = linhaNos.get(i);
        let destino = linhaNos.get(i + 1);

        let novosNos = rotacionarEMover(poligono.getNodes(), nRef1, nRef2, origem, destino, rotacionar);

        // Detecta fechamento pelo nó original
        const origNodesList = poligono.getNodes();
        const eraFechado = origNodesList.size() >= 2 &&
            origNodesList.get(0) === origNodesList.get(origNodesList.size() - 1);
        if (eraFechado && novosNos.length > 1) novosNos.pop();

        const wayNodes = new ArrayList();
        for (let j = 0; j < novosNos.length; j++) {
            comandos.add(new AddCommand(layer.data, novosNos[j]));
            wayNodes.add(novosNos[j]);
        }
        wayNodes.add(novosNos[0]);

        const wayNovo = new Way();
        wayNovo.setNodes(wayNodes);
        wayNovo.setKeys(poligono.getKeys());
        comandos.add(new AddCommand(layer.data, wayNovo));
    }

    UndoRedoHandler.getInstance().add(new SequenceCommand("Stamp Orientado ao longo da Linha", comandos));
    new Notification("Polígonos replicados com sucesso!").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
}

stampAlongLine();