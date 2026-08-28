"use strict";

const MainApplication  = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification     = Java.type("org.openstreetmap.josm.gui.Notification");
const Way              = Java.type("org.openstreetmap.josm.data.osm.Way");
const Node             = Java.type("org.openstreetmap.josm.data.osm.Node");
const LatLon           = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const AddCommand       = Java.type("org.openstreetmap.josm.command.AddCommand");
const ChangeCommand    = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const DeleteCommand    = Java.type("org.openstreetmap.josm.command.DeleteCommand");
const SequenceCommand  = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler  = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager        = Java.type("javax.swing.UIManager");
const ArrayList        = Java.type("java.util.ArrayList");
const ImageProvider    = Java.type("org.openstreetmap.josm.tools.ImageProvider");

// Imports para a Interface Gráfica (Swing)
const JDialog          = Java.type("javax.swing.JDialog");
const JPanel           = Java.type("javax.swing.JPanel");
const JLabel           = Java.type("javax.swing.JLabel");
const JTextField       = Java.type("javax.swing.JTextField");
const JCheckBox        = Java.type("javax.swing.JCheckBox");
const JButton          = Java.type("javax.swing.JButton");
const BoxLayout        = Java.type("javax.swing.BoxLayout");
const BorderFactory    = Java.type("javax.swing.BorderFactory");
const FlowLayout       = Java.type("java.awt.FlowLayout");
const Box              = Java.type("javax.swing.Box");
const ActionListener   = Java.extend(Java.type("java.awt.event.ActionListener"));
const WindowAdapter    = Java.extend(Java.type("java.awt.event.WindowAdapter"));

(function () {
    let totalPoligonosCortados = 0;

    // ── MOTOR GEOMÉTRICO ──
    function garantirSentidoHorario(poly) {
        let area = 0;
        for (let i = 0; i < poly.length; i++) {
            const j = (i + 1) % poly.length;
            area += (poly[i].lon * poly[j].lat) - (poly[j].lon * poly[i].lat);
        }
        if (area > 0) poly.reverse();
        return poly;
    }

    function segIntersect(a1, a2, b1, b2) {
        const dax = a2.lon - a1.lon, day = a2.lat - a1.lat;
        const dbx = b2.lon - b1.lon, dby = b2.lat - b1.lat;
        const den = dax * dby - day * dbx;
        if (Math.abs(den) < 1e-12) return null;
        const dx = b1.lon - a1.lon, dy = b1.lat - a1.lat;
        const t  = (dx * dby - dy * dbx) / den;
        const s  = (dx * day - dy * dax) / den;
        const E = 1e-9;
        if (t < -E || t > 1 + E || s < -E || s > 1 + E) return null;
        const tClamped = Math.max(0, Math.min(1, t));
        return { lat: a1.lat + tClamped * day, lon: a1.lon + tClamped * dax };
    }

    // Algoritmo de Ray-Casting
    function isPointInside(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].lon, yi = poly[i].lat;
            const xj = poly[j].lon, yj = poly[j].lat;
            if (((yi > pt.lat) !== (yj > pt.lat)) &&
                pt.lon < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi)
                inside = !inside;
        }
        return inside;
    }

    function getDistanceSq(p1, p2) {
        const dx = p1.lon - p2.lon, dy = p1.lat - p2.lat;
        return dx * dx + dy * dy;
    }

    function computeDifference(pA_raw, pB_raw) {
        const pA = garantirSentidoHorario(pA_raw);
        const pB = garantirSentidoHorario(pB_raw);
        const intersectionPoints = [];

        for (let i = 0; i < pA.length; i++) {
            const a1 = pA[i], a2 = pA[(i + 1) % pA.length];
            for (let j = 0; j < pB.length; j++) {
                const b1 = pB[j], b2 = pB[(j + 1) % pB.length];
                const inter = segIntersect(a1, a2, b1, b2);
                if (inter) {
                    if (!intersectionPoints.some(p => getDistanceSq(p, inter) < 1e-18)) {
                        intersectionPoints.push(inter);
                    }
                }
            }
        }

        function injectIntersections(poly) {
            const result = [];
            for (let i = 0; i < poly.length; i++) {
                const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
                const onSegment = [p1];
                intersectionPoints.forEach(inter => {
                    const d12 = Math.sqrt(getDistanceSq(p1, p2));
                    const d1i = Math.sqrt(getDistanceSq(p1, inter));
                    const di2 = Math.sqrt(getDistanceSq(inter, p2));
                    if (Math.abs((d1i + di2) - d12) < 1e-8) {
                        if (getDistanceSq(p1, inter) > 1e-18 && getDistanceSq(p2, inter) > 1e-18) {
                            onSegment.push(inter);
                        }
                    }
                });
                onSegment.sort((x, y) => getDistanceSq(p1, x) - getDistanceSq(p1, y));
                onSegment.forEach(pt => result.push(pt));
            }
            return result;
        }

        const refinedA = injectIntersections(pA);
        const refinedB = injectIntersections(pB);
        const validSegments = [];

        for (let i = 0; i < refinedA.length; i++) {
            const p1 = refinedA[i], p2 = refinedA[(i + 1) % refinedA.length];
            const mid = { lat: (p1.lat + p2.lat) / 2, lon: (p1.lon + p2.lon) / 2 };
            if (!isPointInside(mid, pB) && getDistanceSq(p1, p2) > 1e-18) {
                validSegments.push({ from: p1, to: p2 });
            }
        }

        for (let i = 0; i < refinedB.length; i++) {
            const p1 = refinedB[i], p2 = refinedB[(i + 1) % refinedB.length];
            const mid = { lat: (p1.lat + p2.lat) / 2, lon: (p1.lon + p2.lon) / 2 };
            if (isPointInside(mid, pA) && getDistanceSq(p1, p2) > 1e-18) {
                validSegments.push({ from: p2, to: p1 });
            }
        }

        const loops = [];
        const used = new Array(validSegments.length).fill(false);

        for (let i = 0; i < validSegments.length; i++) {
            if (used[i]) continue;
            const currentLoop = [validSegments[i].from];
            let currentPt = validSegments[i].to;
            used[i] = true;
            let searching = true;

            while (searching) {
                let foundNext = false;
                let bestIdx = -1;
                let minD = 1e-12;
                for (let j = 0; j < validSegments.length; j++) {
                    if (used[j]) continue;
                    const d = getDistanceSq(validSegments[j].from, currentPt);
                    if (d < minD) { minD = d; bestIdx = j; foundNext = true; }
                }
                if (foundNext) {
                    currentLoop.push(validSegments[bestIdx].from);
                    currentPt = validSegments[bestIdx].to;
                    used[bestIdx] = true;
                } else {
                    searching = false;
                }
                if (getDistanceSq(currentPt, currentLoop[0]) < 1e-12) searching = false;
            }
            if (currentLoop.length >= 3) loops.push(currentLoop);
        }
        return loops;
    }

    function wayToCoords(way) {
        const coords = [];
        for (let i = 0; i < way.getNodesCount() - 1; i++) {
            const n = way.getNode(i);
            const c = n.getCoor();
            coords.push({ lat: c.lat(), lon: c.lon(), nodeA: n });
        }
        return { coords };
    }

    function executarSubtracao(tagCorte, tagAlvo, apagarOrfaosAlvo) {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer || !layer.data) return false;
        const ds = layer.data;

        const polys = [];
        const wi = ds.getSelectedWays().iterator();
        while (wi.hasNext()) {
            const w = wi.next();
            if (w.isClosed()) polys.push(w);
        }
        if (polys.length < 2) return false;

        const alvos = [], cortadores = [];
        polys.forEach(function(w) {
            if (tagCorte === "" && Object.keys(w.getKeys() || {}).length === 0) {
                cortadores.push(w);
            } else if (tagCorte !== "" && w.hasKey(tagCorte)) {
                cortadores.push(w);
            } else if (tagAlvo === "" || w.hasKey(tagAlvo)) {
                alvos.push(w);
            }
        });

        if (cortadores.length === 0 || alvos.length === 0) {
            const sorted = polys.slice().sort(function(a, b) {
                return Object.keys(a.getKeys() || {}).length - Object.keys(b.getKeys() || {}).length;
            });
            cortadores.length = 0; alvos.length = 0;
            cortadores.push(sorted[0]);
            for (let i = 1; i < sorted.length; i++) alvos.push(sorted[i]);
        }

        const cmds = new ArrayList();
        let parcialCortado = 0;
        const nodeCache = new Map();
        
        // Armazena referências dos nós originais dos alvos e os novos nós gerados
        const nosAntigosAlvo = [];
        const nosNovosUtilizados = new Set();

        alvos.forEach(function (poly) {
            for (let ni = 0; ni < poly.getNodesCount(); ni++) {
                const n = poly.getNode(ni);
                if (!nosAntigosAlvo.some(x => x === n)) nosAntigosAlvo.push(n);
            }

            const { coords: pA } = wayToCoords(poly);
            pA.forEach(c => {
                if (c.nodeA) {
                    nodeCache.set(c.lat.toFixed(9) + ',' + c.lon.toFixed(9), c.nodeA);
                }
            });

            let currentGeoms = [pA];
            cortadores.forEach(function (cut) {
                const { coords: pB } = wayToCoords(cut);
                const nextGeoms = [];
                currentGeoms.forEach(g => {
                    computeDifference(g, pB).forEach(d => nextGeoms.push(d));
                });
                currentGeoms = nextGeoms;
            });

            if (currentGeoms.length === 0) {
                cmds.add(new DeleteCommand(ds, poly));
                parcialCortado++;
                return;
            }

            function getOrCreateNode(v) {
                const key = Number(v.lat).toFixed(9) + ',' + Number(v.lon).toFixed(9);
                if (nodeCache.has(key)) {
                    const existingNode = nodeCache.get(key);
                    nosNovosUtilizados.add(existingNode);
                    return existingNode;
                }
                const n = new Node(new LatLon(v.lat, v.lon));
                cmds.add(new AddCommand(ds, n));
                nodeCache.set(key, n);
                nosNovosUtilizados.add(n);
                return n;
            }

            currentGeoms.forEach(function (verts, ri) {
                const nodeList = new ArrayList();
                verts.forEach(function (v) { nodeList.add(getOrCreateNode(v)); });
                if (nodeList.size() < 3) return;
                nodeList.add(nodeList.get(0));

                if (ri === 0) {
                    const wEdit = new Way(poly);
                    wEdit.setNodes(nodeList);
                    cmds.add(new ChangeCommand(poly, wEdit));
                } else {
                    const wNew = new Way();
                    wNew.setNodes(nodeList);
                    wNew.setKeys(poly.getKeys());
                    cmds.add(new AddCommand(ds, wNew));
                }
            });
            parcialCortado++;
        });

        // Coleta e deleta os cortadores
        const nosCortadores = [];
        cortadores.forEach(function (cut) {
            for (let ni = 0; ni < cut.getNodesCount(); ni++) {
                const n = cut.getNode(ni);
                if (!nosCortadores.some(x => x === n)) nosCortadores.push(n);
            }
            cmds.add(new DeleteCommand(ds, cut));
        });

        // Limpeza dos nós exclusivos do cortador
        nosCortadores.forEach(function (n) {
            if (n.getDataSet() === null) return;
            const refs = n.getReferrers();
            let soCorte = true;
            for (let ri = 0; ri < refs.size(); ri++) {
                const ref = refs.get(ri);
                if (!cortadores.some(c => c === ref)) { soCorte = false; break; }
            }
            if (soCorte) cmds.add(new DeleteCommand(ds, n));
        });

        // Verifica se o nó antigo foi descartado
        if (apagarOrfaosAlvo) {
            nosAntigosAlvo.forEach(function (n) {
                if (n.getDataSet() === null) return;
                
                if (nosNovosUtilizados.has(n)) return;

                const refs = n.getReferrers();
                let exclusivoDoAlvoAlterado = true;

                for (let ri = 0; ri < refs.size(); ri++) {
                    const ref = refs.get(ri);
                    if (!alvos.some(a => a === ref) && !cortadores.some(c => c === ref)) {
                        exclusivoDoAlvoAlterado = false;
                        break;
                    }
                }

                if (exclusivoDoAlvoAlterado) {
                    cmds.add(new DeleteCommand(ds, n));
                }
            });
        }

        if (!cmds.isEmpty() && parcialCortado > 0) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Subtração de Polígono", cmds));
            totalPoligonosCortados += parcialCortado;
            return true;
        }
        return false;
    }

    // ── MONTAGEM DO DIÁLOGO ──
    const dialog = new JDialog(MainApplication.getMainFrame(), "Subtração de Áreas", false);
    dialog.setDefaultCloseOperation(2); 

    const mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));

    const rowCorte = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 0));
    rowCorte.add(new JLabel("Tag do Corte:"));
    const txtCorte = new JTextField("building", 12);
    rowCorte.add(txtCorte);
    mainPanel.add(rowCorte);
    mainPanel.add(Box.createVerticalStrut(6));

    const rowAlvo = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 0));
    rowAlvo.add(new JLabel("Tag do Alvo: "));
    const txtAlvo = new JTextField("power", 12);
    rowAlvo.add(txtAlvo);
    mainPanel.add(rowAlvo);
    mainPanel.add(Box.createVerticalStrut(6));

    const rowCheck = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 0));
    const chkOrfaos = new JCheckBox("Apagar nós órfãos do alvo", true);
    rowCheck.add(chkOrfaos);
    mainPanel.add(rowCheck);
    mainPanel.add(Box.createVerticalStrut(10));

    // Instanciação dos botões
    const btnCortar = new JButton("Cortar", ImageProvider.getIfAvailable("apply"));
    const btnOk     = new JButton("OK", UIManager.getIcon("OptionPane.yesIcon"));
    const btnCan    = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));

    // Botão Cortar
    const rowBtnCortar = new JPanel(new FlowLayout(FlowLayout.CENTER, 0, 0));
    rowBtnCortar.add(btnCortar);
    mainPanel.add(rowBtnCortar);
    mainPanel.add(Box.createVerticalStrut(6));

    // Botões OK e Cancelar
    const rowBtnControle = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
    rowBtnControle.add(btnOk);
    rowBtnControle.add(btnCan);
    mainPanel.add(rowBtnControle);

    // Configuração dos Eventos dos Botões
    btnCortar.addActionListener(new ActionListener({
        actionPerformed: function() {
            const tagC = String(txtCorte.getText()).trim();
            const tagA = String(txtAlvo.getText()).trim();
            const apagarOrfaos = chkOrfaos.isSelected();
            
            const sucesso = executarSubtracao(tagC, tagA, apagarOrfaos);
            
            if (!sucesso) {
                new Notification("Nenhum polígono válido encontrado ou modificado na seleção atual.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            } else {
                dialog.setTitle("Subtração de Áreas (" + totalPoligonosCortados + " cortes)");
            }
        }
    }));

    let isCleanedUp = false;
    let windowAdapter = null;

    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        if (dialog) {
            try {
                const listeners = dialog.getWindowListeners();
                for (let i = 0; i < listeners.length; i++) {
                    dialog.removeWindowListener(listeners[i]);
                }
            } catch(e) {}
            if (windowAdapter) {
                try { dialog.removeWindowListener(windowAdapter); } catch(e) {}
                windowAdapter = null;
            }
            try { dialog.dispose(); } catch(e) {}
        }
    };

    if (typeof __josmContextResetHooks__ !== 'undefined') {
        __josmContextResetHooks__.register(cleanup);
    }
    if (typeof josmContextResetHooks !== 'undefined') {
        josmContextResetHooks.register(cleanup);
    }

    if (globalThis.__scriptCleanup__) {
        try { globalThis.__scriptCleanup__(); } catch(e) {}
    }
    if (globalThis.scriptCleanup) {
        try { globalThis.scriptCleanup(); } catch(e) {}
    }
    globalThis.__scriptCleanup__ = cleanup;
    globalThis.scriptCleanup = cleanup;

    btnOk.addActionListener(new ActionListener({
        actionPerformed: function() {
            cleanup();
            if (totalPoligonosCortados > 0) {
                new Notification("Sessão finalizada.\nTotal de " + totalPoligonosCortados + " polígono(s) processado(s) com sucesso!")
                    .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            } else {
                new Notification("Sessão encerrada. Nenhuma alteração foi realizada.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            }
        }
    }));

    btnCan.addActionListener(new ActionListener({
        actionPerformed: function() {
            cleanup();
        }
    }));

    windowAdapter = new WindowAdapter({
        windowClosing: function() {
            cleanup();
        }
    });
    dialog.addWindowListener(windowAdapter);

    dialog.add(mainPanel);
    dialog.pack();
    dialog.setResizable(false);
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());

    dialog.setVisible(true);
})();