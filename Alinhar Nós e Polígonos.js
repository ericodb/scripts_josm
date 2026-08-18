"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification = Java.type("org.openstreetmap.josm.gui.Notification");
const MoveCommand = Java.type("org.openstreetmap.josm.command.MoveCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const Way = Java.type("org.openstreetmap.josm.data.osm.Way");
const Node = Java.type("org.openstreetmap.josm.data.osm.Node");
const EastNorth = Java.type("org.openstreetmap.josm.data.coor.EastNorth");
const ProjectionRegistry = Java.type("org.openstreetmap.josm.data.projection.ProjectionRegistry");

const UIManager = Java.type("javax.swing.UIManager");
const JRadioButton = Java.type("javax.swing.JRadioButton");
const ButtonGroup = Java.type("javax.swing.ButtonGroup");
const JPanel = Java.type("javax.swing.JPanel");
const BorderFactory = Java.type("javax.swing.BorderFactory");
const JButton = Java.type("javax.swing.JButton");
const JDialog = Java.type("javax.swing.JDialog");
const GridLayout = Java.type("java.awt.GridLayout");
const BorderLayout = Java.type("java.awt.BorderLayout");
const ArrayList = Java.type("java.util.ArrayList");

// --- Auxiliares ---

function pontoAoLongo(a, b, t) {
    return new EastNorth(
        a.east() + (b.east() - a.east()) * t,
        a.north() + (b.north() - a.north()) * t
    );
}

function distancia(a, b) {
    const dx = a.east() - b.east();
    const dy = a.north() - b.north();
    return Math.sqrt(dx * dx + dy * dy);
}

function centroide(way, proj) {
    const nodes = way.getNodes();
    let x = 0, y = 0, n = 0;
    for (let i = 0; i < nodes.size(); i++) {
        const en = proj.latlon2eastNorth(nodes.get(i).getCoor());
        x += en.east(); y += en.north(); n++;
    }
    return new EastNorth(x / n, y / n);
}

function calcularCentroidePar(ways, proj) {
    let totalX = 0, totalY = 0, totalN = 0;
    ways.forEach(way => {
        const nodes = way.getNodes();
        for (let i = 0; i < nodes.size(); i++) {
            const en = proj.latlon2eastNorth(nodes.get(i).getCoor());
            totalX += en.east(); totalY += en.north(); totalN++;
        }
    });
    return new EastNorth(totalX / totalN, totalY / totalN);
}

function topoPoligono(way, proj) {
    const nodes = way.getNodes();
    const pts = [];
    for (let i = 0; i < nodes.size(); i++) {
        pts.push(proj.latlon2eastNorth(nodes.get(i).getCoor()));
    }
    pts.sort((a, b) => b.north() - a.north());
    return new EastNorth(
        (pts[0].east() + pts[1].east()) / 2,
        (pts[0].north() + pts[1].north()) / 2
    );
}

// Ordenação eixo dominante + refinamento por projeção
function ordenar(items, getCentro) {
    const pontos = items.map(getCentro);
    const n = pontos.length;
    const mx = pontos.reduce((s, p) => s + p.east(),  0) / n;
    const my = pontos.reduce((s, p) => s + p.north(), 0) / n;
    const varX = pontos.reduce((s, p) => s + Math.pow(p.east()  - mx, 2), 0);
    const varY = pontos.reduce((s, p) => s + Math.pow(p.north() - my, 2), 0);
    const dominaX = varX >= varY;

    const sorted = items.slice().sort((a, b) => {
        const ca = getCentro(a), cb = getCentro(b);
        return dominaX ? ca.east() - cb.east() : ca.north() - cb.north();
    });

    const A = getCentro(sorted[0]);
    const B = getCentro(sorted[n - 1]);
    const abx = B.east()  - A.east();
    const aby = B.north() - A.north();
    const len2 = abx * abx + aby * aby || 1;

    return sorted.sort((a, b) => {
        const ca = getCentro(a), cb = getCentro(b);
        const ta = ((ca.east() - A.east()) * abx + (ca.north() - A.north()) * aby) / len2;
        const tb = ((cb.east() - A.east()) * abx + (cb.north() - A.north()) * aby) / len2;
        return ta - tb;
    });
}

function encontrarPoligonoPai(node, dataset) {
    const refs = node.getReferrers();
    for (let i = 0; i < refs.size(); i++) {
        const ref = refs.get(i);
        if (ref instanceof Way && ref.isClosed()) return ref;
    }
    return null;
}

// Agrupa nós por polígono pai — garante que nós do mesmo polígono ficam juntos
function agruparPorPoligono(nodes, dataset, proj) {
    const mapa = new Map();
    nodes.forEach(node => {
        const poly = encontrarPoligonoPai(node, dataset);
        const key  = poly ? poly.getUniqueId() : node.getUniqueId();
        if (!mapa.has(key)) {
            mapa.set(key, {
                poly,
                nodes: [],
                topo: poly ? topoPoligono(poly, proj) : node.getEastNorth()
            });
        }
        mapa.get(key).nodes.push(node);
    });
    return Array.from(mapa.values()).map(g => {
        const ens = g.nodes.map(n => n.getEastNorth());
        const cx  = ens.reduce((s, e) => s + e.east(),  0) / ens.length;
        const cy  = ens.reduce((s, e) => s + e.north(), 0) / ens.length;
        g.centro = new EastNorth(cx, cy);
        return g;
    });
}

// --- Alinhar Nós ---

function alinharNos(dataset, modoPares) {
    let selectedNodes = [];
    const it = dataset.getSelectedNodes().iterator();
    while (it.hasNext()) selectedNodes.push(it.next());

    if (selectedNodes.length < 4) {
        new Notification("Selecione pelo menos 4 nós.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }

    const proj   = ProjectionRegistry.getProjection();
    const grupos = agruparPorPoligono(selectedNodes, dataset, proj);
    const numG   = grupos.length;

    if (!modoPares) {
        // --- INDIVIDUAL ---
        if (numG < 3) {
            new Notification("Selecione nós de pelo menos 3 polígonos.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            return;
        }

        // Ordenar grupos pelo topo do polígono
        const ordenados = ordenar(grupos, g => g.topo);
        const A = ordenados[0].centro;
        const C = ordenados[numG - 1].centro;

        const commands = new ArrayList();
        for (let i = 1; i < numG - 1; i++) {
            const g    = ordenados[i];
            const t    = i / (numG - 1);
            const alvo = pontoAoLongo(A, C, t);
            const dx = alvo.east()  - g.centro.east();
            const dy = alvo.north() - g.centro.north();
            if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
                // Mover todos os nós do grupo pelo mesmo dx/dy
                g.nodes.forEach(node => commands.add(new MoveCommand(node, dx, dy)));
            }
        }

        if (!commands.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Alinhar nós individual", commands));
            new Notification("Nós alinhados com sucesso.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Nenhum nó precisou ser movido.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }

    } else {
        // --- PARES ---
        // Ordenar grupos e agrupar em pares consecutivos (igual ao original: 4 nós por vez)
        if (numG < 6) {
            new Notification("Selecione nós de pelo menos 6 polígonos para o modo Pares.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const ordenados = ordenar(grupos, g => g.topo);

        // Agrupar pares consecutivos
        const pares = [];
        for (let i = 0; i + 1 < numG; i += 2) {
            const g1 = ordenados[i];
            const g2 = ordenados[i + 1];
            const allNodes = g1.nodes.concat(g2.nodes);
            const ens = allNodes.map(n => n.getEastNorth());
            const cx  = ens.reduce((s, e) => s + e.east(),  0) / ens.length;
            const cy  = ens.reduce((s, e) => s + e.north(), 0) / ens.length;
            const topoMedio = new EastNorth(
                (g1.topo.east()  + g2.topo.east())  / 2,
                (g1.topo.north() + g2.topo.north()) / 2
            );
            pares.push({ nodes: allNodes, centro: new EastNorth(cx, cy), topo: topoMedio });
        }

        const numPares = pares.length;
        if (numPares < 3) {
            new Notification("São necessários pelo menos 3 pares.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const paresOrdenados = ordenar(pares, p => p.topo);
        const A = paresOrdenados[0].centro;
        const C = paresOrdenados[numPares - 1].centro;

        const commands = new ArrayList();
        for (let i = 1; i < numPares - 1; i++) {
            const par  = paresOrdenados[i];
            const t    = i / (numPares - 1);
            const alvo = pontoAoLongo(A, C, t);
            const dx = alvo.east()  - par.centro.east();
            const dy = alvo.north() - par.centro.north();
            if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
                par.nodes.forEach(node => commands.add(new MoveCommand(node, dx, dy)));
            }
        }

        if (!commands.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Alinhar nós pares", commands));
            new Notification("Nós alinhados com sucesso.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Nenhum nó precisou ser movido.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    }
}

// --- Alinhar Polígonos ---
function alinharPoligonos(dataset, modoPares) {
    let ways = [];
    const it = dataset.getSelectedWays().iterator();
    while (it.hasNext()) ways.push(it.next());

    const total = ways.length;
    if (total < 3) {
        new Notification("Selecione pelo menos 3 polígonos fechados.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        return;
    }
    if (modoPares && total % 2 !== 0) {
        new Notification("Para o modo 'Pares', selecione um número PAR de polígonos (mínimo de 6).")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    const proj  = ProjectionRegistry.getProjection();
    const items = ways.map(way => ({ way, centro: centroide(way, proj) }));

    // Ordenação robusta pelos centros
    const ordenados = ordenar(items, i => i.centro);
    const comandos  = new ArrayList();

    if (!modoPares) {
        const A = ordenados[0].centro;
        const C = ordenados[total - 1].centro;

        for (let i = 1; i < total - 1; i++) {
            const el   = ordenados[i];
            const t    = i / (total - 1);
            const alvo = pontoAoLongo(A, C, t);
            const dx = alvo.east()  - el.centro.east();
            const dy = alvo.north() - el.centro.north();
            if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
                comandos.add(new MoveCommand(el.way, dx, dy));
            }
        }
    } else {
        const numPares = Math.floor(total / 2);
        if (numPares < 3) {
            new Notification("Selecione pelo menos 6 polígonos para o modo Pares.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const pares = [];
        for (let i = 0; i < numPares; i++) {
            const w1 = ordenados[i * 2];
            const w2 = ordenados[i * 2 + 1];
            pares.push({
                w1, w2,
                centro: calcularCentroidePar([w1.way, w2.way], proj)
            });
        }

        const A = pares[0].centro;
        const C = pares[numPares - 1].centro;

        for (let i = 1; i < numPares - 1; i++) {
            const par  = pares[i];
            const t    = i / (numPares - 1);
            const alvo = pontoAoLongo(A, C, t);
            const dx = alvo.east()  - par.centro.east();
            const dy = alvo.north() - par.centro.north();
            if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
                comandos.add(new MoveCommand(par.w1.way, dx, dy));
                comandos.add(new MoveCommand(par.w2.way, dx, dy));
            }
        }
    }

    if (!comandos.isEmpty()) {
        UndoRedoHandler.getInstance().add(new SequenceCommand("Distribuir polígonos como escada", comandos));
        new Notification("Polígonos reposicionados corretamente.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    } else {
        new Notification("Nada foi ajustado.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
    }
}

// --- Interface ---

function main() {
    const dataset = MainApplication.getLayerManager().getEditDataSet();
    if (!dataset) {
        new Notification("Nenhuma camada ativa.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    const parent = MainApplication.getMainFrame();
    const dialog = new JDialog(parent, "Configurações de Alinhamento", true);
    dialog.setLayout(new BorderLayout());

    const mainPanel = new JPanel(new GridLayout(0, 1));

    const typePanel = new JPanel();
    typePanel.setBorder(BorderFactory.createTitledBorder("Tipo de Alinhamento"));
    const typeGroup = new ButtonGroup();
    const radioNos  = new JRadioButton("Alinhar Nós", false);
    const radioRets = new JRadioButton("Alinhar Polígonos", true);
    [radioNos, radioRets].forEach(r => { typeGroup.add(r); typePanel.add(r); });

    const modePanel = new JPanel();
    modePanel.setBorder(BorderFactory.createTitledBorder("Modo"));
    const modeGroup       = new ButtonGroup();
    const radioIndividual = new JRadioButton("Individual", true);
    const radioPares      = new JRadioButton("Pares", false);
    [radioIndividual, radioPares].forEach(r => { modeGroup.add(r); modePanel.add(r); });

    mainPanel.add(typePanel);
    mainPanel.add(modePanel);

    const buttonPanel = new JPanel();
    const okBtn     = new JButton("Aceitar",  UIManager.getIcon("OptionPane.yesIcon"));
    const cancelBtn = new JButton("Cancelar", UIManager.getIcon("OptionPane.cancelIcon"));
    buttonPanel.add(okBtn);
    buttonPanel.add(cancelBtn);

    dialog.add(mainPanel, BorderLayout.CENTER);
    dialog.add(buttonPanel, BorderLayout.SOUTH);

    okBtn.addActionListener(function(e) {
        const modoPares = radioPares.isSelected();
        if (radioNos.isSelected()) {
            alinharNos(dataset, modoPares);
        } else {
            alinharPoligonos(dataset, modoPares);
        }
        dialog.dispose();
    });

    cancelBtn.addActionListener(function(e) {
        new Notification("Operação cancelada.").setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        dialog.dispose();
    });

    dialog.pack();
    dialog.setLocationRelativeTo(parent);
    dialog.setVisible(true);
}

main();