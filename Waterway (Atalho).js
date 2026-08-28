"use strict";

if (globalThis.scriptCleanup) {
    try { globalThis.scriptCleanup(); } catch(e) {}
}

// --- Importações de API ---
const MainApplication    = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification       = Java.type("org.openstreetmap.josm.gui.Notification");
const UndoRedoHandler    = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const SequenceCommand    = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const AddCommand         = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeNodesCommand = Java.type("org.openstreetmap.josm.command.ChangeNodesCommand");
const Node               = Java.type("org.openstreetmap.josm.data.osm.Node");
const Way                = Java.type("org.openstreetmap.josm.data.osm.Way");
const LatLon             = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const UIManager          = Java.type("javax.swing.UIManager");
const JDialog            = Java.type("javax.swing.JDialog");
const JButton            = Java.type("javax.swing.JButton");
const JPanel             = Java.type("javax.swing.JPanel");
const JLabel             = Java.type("javax.swing.JLabel");
const Color              = Java.type("java.awt.Color");
const Font               = Java.type("java.awt.Font");
const KeyboardFocusManager = Java.type("java.awt.KeyboardFocusManager");
const KeyEvent           = Java.type("java.awt.event.KeyEvent");
const LineBorder         = Java.type("javax.swing.border.LineBorder");
const SwingTimer         = Java.type("javax.swing.Timer");

// --- Java.extend para listeners ---
const ActionListener     = Java.extend(Java.type("java.awt.event.ActionListener"));
const WindowAdapter      = Java.extend(Java.type("java.awt.event.WindowAdapter"));
const KeyEventDispatcher = Java.extend(Java.type("java.awt.KeyEventDispatcher"));

const SwingUtilities     = Java.type("javax.swing.SwingUtilities");

// LayerChangeListener no escopo global — padrão GraalVM/JOSM
const LayerChangeListener = Java.extend(
    Java.type("org.openstreetmap.josm.gui.layer.LayerManager$LayerChangeListener"), {
        layerAdded:        function (_e) {},
        layerOrderChanged: function (_e) {},
        layerRemoving:     function (e) {
            try {
                const removed = e.getRemovedLayer();
                // Compara com o sourceDs salvo na abertura do diálogo —
                // não chama getEditDataSet() que pode lançar exceção durante remoção
                const removedDs = (removed && removed.data) ? removed.data : null;
                const sourceDs  = globalThis.culvertToolState.sourceDs;
                if (removedDs !== null && sourceDs !== null && removedDs === sourceDs) {
                    SwingUtilities.invokeLater(function () {
                        culvertCleanUp();
                        new Notification("Camada removida. Diálogo fechado.")
                            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                    });
                }
            } catch (ex) {}
        }
    }
);

let isCleanedUp = false;
function culvertCleanUp() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    if (globalThis.culvertToolState.dispatcher) {
        try {
            KeyboardFocusManager.getCurrentKeyboardFocusManager()
                .removeKeyEventDispatcher(globalThis.culvertToolState.dispatcher);
        } catch (e) {}
        globalThis.culvertToolState.dispatcher = null;
    }
    if (globalThis.culvertToolState.layerListener) {
        try {
            MainApplication.getLayerManager()
                .removeLayerChangeListener(globalThis.culvertToolState.layerListener);
        } catch (e) {}
        globalThis.culvertToolState.layerListener = null;
    }
    if (globalThis.culvertToolState.dialog) {
        try {
            const listeners = globalThis.culvertToolState.dialog.getWindowListeners();
            for (let i = 0; i < listeners.length; i++) {
                globalThis.culvertToolState.dialog.removeWindowListener(listeners[i]);
            }
        } catch (e) {}
        try { globalThis.culvertToolState.dialog.dispose(); } catch (e) {}
        globalThis.culvertToolState.dialog = null;
    }
    globalThis.culvertToolState.shortcutEnabled = false;
    globalThis.culvertToolState.sourceDs = null;
}

if (typeof __josmContextResetHooks__ !== 'undefined') {
    __josmContextResetHooks__.register(culvertCleanUp);
}
if (typeof josmContextResetHooks !== 'undefined') {
    josmContextResetHooks.register(culvertCleanUp);
}
globalThis.__scriptCleanup__ = culvertCleanUp;
globalThis.scriptCleanup = culvertCleanUp;

// --- Estado Global ---
globalThis.culvertToolState = globalThis.culvertToolState || {
    shortcutEnabled: false,
    dialog: null,
    dispatcher: null,   // referência ao dispatcher para remoção no fechamento
    layerListener: null, // referência ao listener de camada
    sourceDs: null      // DataSet da camada no momento da abertura
};

// --- Lógica Principal ---
const CulvertLogic = {
    toRad: (deg) => deg * Math.PI / 180,
    toDeg: (rad) => rad * 180 / Math.PI,

    calculateBearing: function(lat1, lon1, lat2, lon2) {
        const phi1 = this.toRad(lat1), phi2 = this.toRad(lat2);
        const dlon = this.toRad(lon2 - lon1);
        const x = Math.sin(dlon) * Math.cos(phi2);
        const y = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlon);
        return (this.toDeg(Math.atan2(x, y)) + 360) % 360;
    },

    offsetPoint: function(lat, lon, dist, brng) {
        const R = 6378137.0, lat1 = this.toRad(lat), b = this.toRad(brng);
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist / R) + Math.cos(lat1) * Math.sin(dist / R) * Math.cos(b));
        const lon2 = this.toRad(lon) + Math.atan2(Math.sin(b) * Math.sin(dist / R) * Math.cos(lat1), Math.cos(dist / R) - Math.sin(lat1) * Math.sin(lat2));
        return [this.toDeg(lat2), this.toDeg(lon2)];
    },

    // Distância em metros entre dois pontos [lat,lon]
    distMetros: function(a, b) {
        const R = 6378137.0;
        const dLat = this.toRad(b[0] - a[0]);
        const dLon = this.toRad(b[1] - a[1]);
        const sinLat = Math.sin(dLat / 2);
        const sinLon = Math.sin(dLon / 2);
        const h = sinLat * sinLat +
                  Math.cos(this.toRad(a[0])) * Math.cos(this.toRad(b[0])) * sinLon * sinLon;
        return 2 * R * Math.asin(Math.sqrt(h));
    },

    // Empurra nós externos que caem dentro da bbox do bueiro para fora dele.
    // A bbox é definida ao longo do eixo nBefore→nAfter com largura BBOX_HALFWIDTH.
    // Nós pertencentes ao próprio bueiro são ignorados.
    // Retorna lista de ChangeCommand para adicionar ao lote de comandos.
    empurrarNosForaDoBueiro: function(ds, wNodes, nBefore, nAfter, cmds) {
        // Qualquer nó do waterway dentro da faixa ao longo do eixo do bueiro
        // é empurrado para SAFE_DIST metros do centro do bueiro, no mesmo lado
        // em que já se encontra (perp >= 0 → direita, perp < 0 → esquerda).
        const SAFE_DIST  =  2.0; // distância do 1º nó além do bueiro (m)
        const SAFE_STEP  =  -1.0; // incremento por nó adicional (m): 2º nó = SAFE_DIST+SAFE_STEP, etc.
        const ALONG_TOL  =  1.0; // tolerância nas pontas do eixo (m)

        const latB = nBefore.getCoor().lat(), lonB = nBefore.getCoor().lon();
        const latA = nAfter.getCoor().lat(),  lonA = nAfter.getCoor().lon();

        const mLat = 111319.492;
        const mLon = mLat * Math.cos(this.toRad((latB + latA) / 2));

        // Eixo do bueiro em metros locais
        const axisX = (lonA - lonB) * mLon;
        const axisY = (latA - latB) * mLat;
        const axisLen = Math.sqrt(axisX * axisX + axisY * axisY);
        if (axisLen < 0.01) return;

        const ux = axisX / axisLen, uy = axisY / axisLen; // unitário ao longo
        const px = -uy,             py =  ux;              // unitário perpendicular

        // IDs dos nós do próprio bueiro — não mover
        const culvertNodeIds = new Set();
        for (let k = 0; k < wNodes.size(); k++) {
            const n = wNodes.get(k);
            if (n === nBefore || n === nAfter) culvertNodeIds.add(n.getUniqueId());
        }

        // Centro do bueiro em coords locais
        const cx = (axisX / 2), cy = (axisY / 2);
        const ox = lonB * mLon, oy = latB * mLat;

        // Coleta nós a mover separados por lado (antes/depois do bueiro),
        // ordenados do mais próximo ao mais distante do bueiro.
        // Cada nó recebe SAFE_DIST + índice * SAFE_STEP metros de afastamento,
        // garantindo que nós múltiplos não se sobreponham.
        const ladoAntes = []; // nós na metade inicial (along <= meio)
        const ladoDepois = []; // nós na metade final (along > meio)
        const meio = axisLen / 2;

        // Raio máximo de busca: SAFE_DIST além de cada extremidade do bueiro
        // Evita varrer o waterway inteiro quando ele é muito longo
        const SEARCH_RADIUS = axisLen + SAFE_DIST + 1.0;

        for (let k = 0; k < wNodes.size(); k++) {
            const n = wNodes.get(k);
            if (culvertNodeIds.has(n.getUniqueId())) continue;

            // Rejeição rápida por distância antes de calcular projeções
            const quickDist = this.distMetros(
                [latB, lonB],
                [n.getCoor().lat(), n.getCoor().lon()]
            );
            if (quickDist > SEARCH_RADIUS) continue;

            const nx = n.getCoor().lon() * mLon - ox;
            const ny = n.getCoor().lat() * mLat - oy;
            const along = nx * ux + ny * uy;

            if (along < -ALONG_TOL || along > axisLen + ALONG_TOL) continue;

            if (along <= meio) {
                ladoAntes.push({ n: n, along: along });
            } else {
                ladoDepois.push({ n: n, along: along });
            }
        }

        // Ordena: lado antes do mais distante ao mais próximo do bueiro (along desc → sai primeiro)
        // lado depois do mais próximo ao mais distante (along asc → sai primeiro)
        ladoAntes.sort((a, b) => a.along - b.along); // menor along = mais longe de nBefore
        ladoDepois.sort((a, b) => b.along - a.along); // maior along = mais longe de nAfter

        // Aplica deslocamento incremental: 1º nó → SAFE_DIST, 2º → SAFE_DIST+SAFE_STEP, etc.
        ladoAntes.forEach(function(entry, idx) {
            const dist = SAFE_DIST + idx * SAFE_STEP;
            const targetAlong = -dist;
            const deltaAlong = targetAlong - entry.along;
            const newLon = entry.n.getCoor().lon() + (ux * deltaAlong) / mLon;
            const newLat = entry.n.getCoor().lat() + (uy * deltaAlong) / mLat;
            const newNode = new Node(entry.n);
            newNode.setCoor(new LatLon(newLat, newLon));
            cmds.add(new (Java.type("org.openstreetmap.josm.command.ChangeCommand"))(ds, entry.n, newNode));
        });

        ladoDepois.forEach(function(entry, idx) {
            const dist = SAFE_DIST + idx * SAFE_STEP;
            const targetAlong = axisLen + dist;
            const deltaAlong = targetAlong - entry.along;
            const newLon = entry.n.getCoor().lon() + (ux * deltaAlong) / mLon;
            const newLat = entry.n.getCoor().lat() + (uy * deltaAlong) / mLat;
            const newNode = new Node(entry.n);
            newNode.setCoor(new LatLon(newLat, newLon));
            cmds.add(new (Java.type("org.openstreetmap.josm.command.ChangeCommand"))(ds, entry.n, newNode));
        });
    },

    segIntersection: function(p1, p2, q1, q2) {
        const avgLat = this.toRad((p1[0] + p2[0] + q1[0] + q2[0]) / 4.0);
        const toXY = (p) => [this.toRad(p[1]) * Math.cos(avgLat), this.toRad(p[0])];
        const [p1x, p1y] = toXY(p1); const [p2x, p2y] = toXY(p2);
        const [q1x, q1y] = toXY(q1); const [q2x, q2y] = toXY(q2);
        const denom = (p2x - p1x) * (q2y - q1y) - (p2y - p1y) * (q2x - q1x);
        if (Math.abs(denom) < 1e-15) return null;
        const t = ((q1x - p1x) * (q2y - q1y) - (q1y - p1y) * (q2x - q1x)) / denom;
        const u = ((q1x - p1x) * (p2y - p1y) - (q1y - p1y) * (p2x - p1x)) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return [[this.toDeg(p1y + t * (p2y - p1y)), this.toDeg((p1x + t * (p2x - p1x)) / Math.cos(avgLat))], t];
    },

    run: function() {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer) {
            new Notification("Nenhuma camada de dados ativa encontrada")
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
            return;
        }

        const ds = layer.data;
        const selectedWays = ds.getSelectedWays().toArray();
        const waterways = selectedWays.filter(w => w.get("waterway") && w.get("tunnel") !== "culvert");
        const allHighways = selectedWays.filter(w => w.get("highway"));
        const normalHighways = allHighways.filter(w => !w.get("bridge"));

        if (waterways.length === 0 && allHighways.length === 0) {
            new Notification("Nenhum waterway ou highway selecionado")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const cmds = new java.util.ArrayList();
        let totalCulverts = 0;

        waterways.forEach(waterway => {
            let wNodes = new java.util.ArrayList(waterway.getNodes());
            let newNodesInfo = [];

            // Conjunto de IDs de nós compartilhados entre waterway e qualquer highway.
            // Se a interseção ocorre exatamente num nó compartilhado, já é topologia
            // OSM correta — não deve gerar bueiro.
            const sharedNodeIds = new Set();
            const wNodeIds = new Set();
            for (let k = 0; k < wNodes.size(); k++)
                wNodeIds.add(wNodes.get(k).getUniqueId());
            normalHighways.forEach(hw => {
                const hNodes = hw.getNodes();
                for (let k = 0; k < hNodes.size(); k++) {
                    const id = hNodes.get(k).getUniqueId();
                    if (wNodeIds.has(id)) sharedNodeIds.add(id);
                }
            });

            // Pré-calcula coords + IDs de todos os segmentos das highways uma única vez
            const hwSegs = [];
            normalHighways.forEach(hw => {
                const hNodes = hw.getNodes();
                for (let j = 0; j < hNodes.size() - 1; j++) {
                    hwSegs.push([
                        [hNodes.get(j).getCoor().lat(),   hNodes.get(j).getCoor().lon()],
                        [hNodes.get(j+1).getCoor().lat(), hNodes.get(j+1).getCoor().lon()],
                        hNodes.get(j).getUniqueId(),
                        hNodes.get(j+1).getUniqueId()
                    ]);
                }
            });

            for (let i = 0; i < wNodes.size() - 1; i++) {
                // Ignora segmentos cujo nó inicial ou final é compartilhado com uma highway
                const wId1 = wNodes.get(i).getUniqueId();
                const wId2 = wNodes.get(i+1).getUniqueId();
                if (sharedNodeIds.has(wId1) || sharedNodeIds.has(wId2)) continue;

                const p1 = [wNodes.get(i).getCoor().lat(), wNodes.get(i).getCoor().lon()];
                const p2 = [wNodes.get(i+1).getCoor().lat(), wNodes.get(i+1).getCoor().lon()];

                hwSegs.forEach(seg => {
                    const [q1, q2, hId1, hId2] = seg;
                    // Ignora segmento da highway cujos nós são compartilhados com o waterway
                    if (sharedNodeIds.has(hId1) || sharedNodeIds.has(hId2)) return;
                    const interData = this.segIntersection(p1, p2, q1, q2);
                        if (interData) {
                            const [inter, t] = interData;
                            const OFFSET = 5.0;   // metade do comprimento padrão do bueiro (m)
                            const MARGIN = 0.5;   // margem além do último nó bloqueante

                            // Verifica apenas os nós vizinhos imediatos do segmento (i e i+1).
                            // Para waterways com muitos nós próximos da highway, a varredura
                            // completa seria O(n²) — desnecessário pois só os vizinhos diretos
                            // causam o problema de sobreposição no segmento atual.
                            const distP1 = this.distMetros(inter, p1);
                            const distP2 = this.distMetros(inter, p2);
                            const d1 = (distP1 < OFFSET) ? distP1 + MARGIN : OFFSET;
                            const d2 = (distP2 < OFFSET) ? distP2 + MARGIN : OFFSET;

                            const b1 = this.calculateBearing(inter[0], inter[1], p1[0], p1[1]);
                            const b2 = this.calculateBearing(inter[0], inter[1], p2[0], p2[1]);
                            const off1 = this.offsetPoint(inter[0], inter[1], d1, b1);
                            const off2 = this.offsetPoint(inter[0], inter[1], d2, b2);
                            const nBefore = new Node(new LatLon(off1[0], off1[1]));
                            const nAfter  = new Node(new LatLon(off2[0], off2[1]));
                            newNodesInfo.push({ segIdx: i, t: t, nBefore: nBefore, nAfter: nAfter });
                        }
                });
            }

            if (newNodesInfo.length > 0) {
                newNodesInfo.sort((a, b) => b.segIdx - a.segIdx || b.t - a.t);
                newNodesInfo.forEach(info => {
                    cmds.add(new AddCommand(ds, info.nBefore));
                    cmds.add(new AddCommand(ds, info.nAfter));
                    wNodes.add(info.segIdx + 1, info.nBefore);
                    wNodes.add(info.segIdx + 2, info.nAfter);
                });

                let indicesCorte = newNodesInfo.map(info => wNodes.indexOf(info.nBefore))
                    .concat(newNodesInfo.map(info => wNodes.indexOf(info.nAfter)))
                    .sort((a, b) => a - b);

                let lastIdx = 0;
                let segments = [];
                for (let i = 0; i < indicesCorte.length; i++) {
                    segments.push(new java.util.ArrayList(wNodes.subList(lastIdx, indicesCorte[i] + 1)));
                    lastIdx = indicesCorte[i];
                }
                segments.push(new java.util.ArrayList(wNodes.subList(lastIdx, wNodes.size())));

                let maxSegIdx = 0, maxLen = 0;
                segments.forEach((s, idx) => { if (s.size() > maxLen) { maxLen = s.size(); maxSegIdx = idx; } });

                segments.forEach((segNodes, idx) => {
                    if (idx === maxSegIdx) {
                        cmds.add(new ChangeNodesCommand(waterway, segNodes));
                    } else {
                        let newWay = new Way();
                        newWay.setNodes(segNodes);
                        const keys = waterway.getKeys();
                        for (let k in keys) { newWay.put(k, keys[k]); }
                        if (idx % 2 === 1) {
                            newWay.put("tunnel", "culvert");
                            newWay.put("layer", "-1");
                            totalCulverts++;
                            // Empurra nós externos que sobraram dentro da bbox do bueiro
                            const nB = segNodes.get(0);
                            const nA = segNodes.get(segNodes.size() - 1);
                            this.empurrarNosForaDoBueiro(ds, wNodes, nB, nA, cmds);
                        }
                        cmds.add(new AddCommand(ds, newWay));
                    }
                });
            }
        });

        if (totalCulverts > 0) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Dividir waterways com culvert", cmds));
            new Notification("Processo concluído: " + totalCulverts + " bueiros criados")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Nenhuma interseção válida encontrada.\nSelecione highway + waterway sem 'bridge' ou 'culvert'.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
    }
};

// --- Diálogo ---
const CulvertDialog = {
    show: function() {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer) {
            new Notification("Nenhuma camada de edição ativa.")
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
            return;
        }

        // Salva o DataSet da camada ativa para comparação no layerRemoving
        globalThis.culvertToolState.sourceDs = layer.data;

        // Fecha diálogo anterior se existir e remove dispatcher antigo
        if (globalThis.culvertToolState.dialog) {
            globalThis.culvertToolState.dialog.dispose();
        }
        if (globalThis.culvertToolState.dispatcher) {
            KeyboardFocusManager.getCurrentKeyboardFocusManager()
                .removeKeyEventDispatcher(globalThis.culvertToolState.dispatcher);
            globalThis.culvertToolState.dispatcher = null;
        }

        const dialog = new JDialog(MainApplication.getMainFrame(), "Script de Bueiros", false);
        dialog.setSize(320, 230);
        dialog.setLocationRelativeTo(MainApplication.getMainFrame());
        const panel = new JPanel(null);

        const btnToggle = new JButton(globalThis.culvertToolState.shortcutEnabled ? "Ativado" : "Desativado");
        btnToggle.setBounds(75, 10, 150, 40);
        btnToggle.setFont(new Font("Dialog", 1, 18)); // Font.BOLD = 1
        btnToggle.setBackground(globalThis.culvertToolState.shortcutEnabled ? new Color(0, 200, 0) : new Color(200, 0, 0));
        btnToggle.setForeground(Color.BLACK);
        btnToggle.setBorder(new LineBorder(Color.BLACK, 2));
        btnToggle.addActionListener(new ActionListener({
            actionPerformed: () => {
                globalThis.culvertToolState.shortcutEnabled = !globalThis.culvertToolState.shortcutEnabled;
                btnToggle.setText(globalThis.culvertToolState.shortcutEnabled ? "Ativado" : "Desativado");
                btnToggle.setBackground(globalThis.culvertToolState.shortcutEnabled ? new Color(0, 200, 0) : new Color(200, 0, 0));
            }
        }));

        const labelText = "<html><center>Pressione '<b>I</b>' para executar o script.<br>" +
                          "Atalho só funciona se ativado.<br>" +
                          "Necessário plugin UtilsPlugin2.<br>" +
                          "Ou apenas selecione e clique em Executar.</center></html>";
        const label = new JLabel(labelText);
        label.setBounds(15, 55, 290, 70);
        label.setFont(new Font("Dialog", 0, 12)); // Font.PLAIN = 0
        label.setHorizontalAlignment(0);

        const btnExec = new JButton("Executar");
        btnExec.setBounds(75, 135, 150, 40);
        btnExec.setFont(new Font("Dialog", 1, 14)); // Font.BOLD = 1
        btnExec.setBackground(new Color(0, 120, 200));
        btnExec.setForeground(Color.WHITE);
        btnExec.setBorder(new LineBorder(Color.BLACK, 2));
        btnExec.addActionListener(new ActionListener({
            actionPerformed: () => CulvertLogic.run()
        }));

        panel.add(btnToggle);
        panel.add(label);
        panel.add(btnExec);
        dialog.add(panel);

        // --- Dispatcher com timer de 300ms e flag anti-repeat ---
        // KEY_PRESSED pode disparar múltiplas vezes por key-repeat do SO.
        // A flag `pending` garante que apenas o primeiro disparo agenda a execução.
        let pending = false;
        const dispatcher = new KeyEventDispatcher({
            dispatchKeyEvent: function(e) {
                if (e.getID() === KeyEvent.KEY_PRESSED &&
                    e.getKeyCode() === KeyEvent.VK_I &&
                    globalThis.culvertToolState.shortcutEnabled &&
                    globalThis.culvertToolState.dialog !== null &&
                    !pending) {

                    pending = true;
                    const timer = new SwingTimer(300, new ActionListener({
                        actionPerformed: () => {
                            pending = false;
                            CulvertLogic.run();
                        }
                    }));
                    timer.setRepeats(false);
                    timer.start();
                }
                return false; // Não consome o evento, deixa o JOSM processar normalmente
            }
        });

        // Ao fechar pela janela (×): centraliza limpeza em culvertCleanUp
        dialog.addWindowListener(new WindowAdapter({
            windowClosing: () => culvertCleanUp()
        }));

        KeyboardFocusManager.getCurrentKeyboardFocusManager().addKeyEventDispatcher(dispatcher);
        globalThis.culvertToolState.dispatcher = dispatcher;

        // Registra listener de camada para fechar ao excluir a camada ativa
        const ll = new LayerChangeListener();
        globalThis.culvertToolState.layerListener = ll;
        MainApplication.getLayerManager().addLayerChangeListener(ll);

        dialog.setVisible(true);
        globalThis.culvertToolState.dialog = dialog;
    }
};

// --- Início ---
CulvertDialog.show();