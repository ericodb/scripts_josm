"use strict";

// IMPORTS
const Way               = Java.type("org.openstreetmap.josm.data.osm.Way");
const Node              = Java.type("org.openstreetmap.josm.data.osm.Node");
const LatLon            = Java.type("org.openstreetmap.josm.data.coor.LatLon");
const MainApplication   = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification      = Java.type("org.openstreetmap.josm.gui.Notification");
const UIManager         = Java.type("javax.swing.UIManager");
const JDialog           = Java.type("javax.swing.JDialog");
const JPanel            = Java.type("javax.swing.JPanel");
const JButton           = Java.type("javax.swing.JButton");
const JTextField        = Java.type("javax.swing.JTextField");
const JLabel            = Java.type("javax.swing.JLabel");
const JSpinner          = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const GridBagLayout     = Java.type("java.awt.GridBagLayout");
const GridBagConstraints = Java.type("java.awt.GridBagConstraints");
const Insets            = Java.type("java.awt.Insets");
const BorderLayout      = Java.type("java.awt.BorderLayout");
const BorderFactory     = Java.type("javax.swing.BorderFactory");
const Dimension         = Java.type("java.awt.Dimension");
const ArrayList         = Java.type("java.util.ArrayList");
const ChangeCommand     = Java.type("org.openstreetmap.josm.command.ChangeCommand");
const SequenceCommand   = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler   = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");

// --- Java.extend para listeners ---
const ActionListener    = Java.extend(Java.type("java.awt.event.ActionListener"));
const WindowAdapter     = Java.extend(Java.type("java.awt.event.WindowAdapter"));
const KeyEventDispatcher = Java.extend(Java.type("java.awt.KeyEventDispatcher"));
const KeyboardFocusManager = Java.type("java.awt.KeyboardFocusManager");
const KeyEvent          = Java.type("java.awt.event.KeyEvent");

// INÍCIO
const layer = MainApplication.getLayerManager().getEditLayer();

if (!layer || !layer.data) {
    new Notification("Nenhuma camada de edição ativa.")
        .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
} else {
    main();
}

function main() {
    const posicoesOriginais = new Map(); // Node → LatLon original
    //  análise da grade 
    function analisarGrade() {
        const sel = layer.data.getSelected();
        let nodesRef = [], ways = [];
        const it = sel.iterator();
        while (it.hasNext()) {
            let obj = it.next();
            if (obj instanceof Node) nodesRef.push(obj);
            else if (obj instanceof Way)  ways.push(obj);
        }

        if (ways.length === 0) {
            new Notification("Selecione os polígonos da grade.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return null;
        }

        if (nodesRef.length < 2) {
            nodesRef = [ways[0].getNode(0), ways[0].getNode(1)];
            new Notification("Usando orientação baseada no primeiro polígono.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }

        // Captura posições originais de todos os nós envolvidos
        ways.forEach(w => {
            const ns = w.getNodes();
            for (let i = 0; i < ns.size(); i++) {
                const n = ns.get(i);
                if (!posicoesOriginais.has(n)) posicoesOriginais.set(n, n.getCoor());
            }
        });

        const n1 = nodesRef[0].getCoor(), n2 = nodesRef[1].getCoor();
        const mLat = 111320.0;
        const mLon = mLat * Math.cos(n1.lat() * (Math.PI / 180.0));
        const dx = (n2.lon() - n1.lon()) * mLon, dy = (n2.lat() - n1.lat()) * mLat;
        const dBase = Math.hypot(dx, dy);
        if (dBase === 0) return null;

        const ux = dx / dBase, uy = dy / dBase;
        const vx = -uy,        vy = ux;

        // Polígonos que compartilham nós são tratados como um único bloco.
        const wayParent = new Map();
        function find(w) {
            if (!wayParent.has(w)) wayParent.set(w, w);
            if (wayParent.get(w) !== w) wayParent.set(w, find(wayParent.get(w)));
            return wayParent.get(w);
        }
        function union(a, b) { wayParent.set(find(a), find(b)); }

        // Mapeia cada nó para todos os ways que o contêm
        const nodToWays = new Map();
        ways.forEach(w => {
            const ns = w.getNodes();
            for (let i = 0; i < ns.size(); i++) {
                const n = ns.get(i);
                if (!nodToWays.has(n)) nodToWays.set(n, []);
                nodToWays.get(n).push(w);
            }
        });

        // Une ways que compartilham nós
        nodToWays.forEach(wList => {
            for (let i = 1; i < wList.length; i++) union(wList[0], wList[i]);
        });

        // Agrupa ways por componente conectado
        const grupos = new Map();
        ways.forEach(w => {
            const root = find(w);
            if (!grupos.has(root)) grupos.set(root, []);
            grupos.get(root).push(w);
        });

        // Cada grupo vira uma entrada na grade, com centro médio de todos os nós únicos
        let grade = [];
        grupos.forEach(groupWays => {
            const nosUnicos = new Set();
            let sumLat = 0, sumLon = 0, contemRef = false;
            groupWays.forEach(w => {
                const ns = w.getNodes();
                for (let i = 0; i < ns.size(); i++) {
                    const n = ns.get(i);
                    if (!nosUnicos.has(n)) {
                        nosUnicos.add(n);
                        const c = posicoesOriginais.get(n);
                        sumLat += c.lat();
                        sumLon += c.lon();
                    }
                    if (n === nodesRef[0] || n === nodesRef[1]) contemRef = true;
                }
            });
            const count = nosUnicos.size;
            const vDx = ((sumLon / count) - n1.lon()) * mLon;
            const vDy = ((sumLat / count) - n1.lat()) * mLat;
            grade.push({
                nos: Array.from(nosUnicos),
                pPara: vDx * ux + vDy * uy,
                pPerp: vDx * vx + vDy * vy,
                bloqueado: contemRef
            });
        });

        // Agrupa por posição e atribui índices de linha/coluna
        const agrupar = (lista, chave) => {
            let sorted = lista.slice().sort((a, b) => a[chave] - b[chave]);
            let grupos = [], cur = [sorted[0]];
            for (let i = 1; i < sorted.length; i++) {
                if (Math.abs(sorted[i][chave] - sorted[i-1][chave]) < 4.0) cur.push(sorted[i]);
                else { grupos.push(cur); cur = [sorted[i]]; }
            }
            grupos.push(cur);
            grupos.sort((a, b) => a[0][chave] - b[0][chave])
                  .forEach((g, idx) => g.forEach(o => o["idx" + chave] = idx));
        };

        agrupar(grade, 'pPara');
        agrupar(grade, 'pPerp');

        const b = grade.find(g => g.bloqueado);
        const offsetPara = b ? b.idxpPara : 0;
        const offsetPerp = b ? b.idxpPerp : 0;
        grade.forEach(g => {
            g.multPara = g.idxpPara - offsetPara;
            g.multPerp = g.idxpPerp - offsetPerp;
        });

        return { grade, ux, uy, vx, vy, mLat, mLon };
    }

    const d = analisarGrade();
    if (!d) return;

    // Durante o ajuste, os nós são movidos diretamente no dataset.
    // Isso evita que o histórico acumule um comando por clique.
    // Apenas no OK um único SequenceCommand é registrado.
    function aplicarDireto() {
        const offP = parseFloat(txtP.getText());
        const offA = parseFloat(txtA.getText());
        const sParaLon = (d.ux * offA) / d.mLon, sParaLat = (d.uy * offA) / d.mLat;
        const sPerpLon = (d.vx * offP) / d.mLon, sPerpLat = (d.vy * offP) / d.mLat;

        d.grade.forEach(obj => {
            if (obj.bloqueado) return;
            obj.nos.forEach(node => {
                const cOri = posicoesOriginais.get(node);
                if (!cOri) return;
                const nLat = cOri.lat() + (sParaLat * obj.multPara) + (sPerpLat * obj.multPerp);
                const nLon = cOri.lon() + (sParaLon * obj.multPara) + (sPerpLon * obj.multPerp);
                node.setCoor(new LatLon(nLat, nLon));
            });
        });

        layer.invalidate();
        MainApplication.getMap().mapView.repaint();
    }

    function restaurarOriginais() {
        posicoesOriginais.forEach((coor, node) => node.setCoor(coor));
        layer.invalidate();
        MainApplication.getMap().mapView.repaint();
    }

function confirmarNoHistorico() {
    const cmds = new ArrayList();
    
    posicoesOriginais.forEach((cOri, node) => {
        const cAtual = node.getCoor();
        
        // Verifica se houve mudança significativa (tolerância de precisão)
        if (Math.abs(cAtual.lat() - cOri.lat()) < 1e-10 &&
            Math.abs(cAtual.lon() - cOri.lon()) < 1e-10) return;

        let nodDepois = new Node(node); 
        nodDepois.setCoor(cAtual);
        node.setCoor(cOri);
        cmds.add(new ChangeCommand(node, nodDepois));
    });

    if (!cmds.isEmpty()) {
        const seq = new SequenceCommand("Ajuste de Grade", cmds);
        UndoRedoHandler.getInstance().add(seq);
        
        layer.invalidate();
        MainApplication.getMap().mapView.repaint();
    }
}

    //  UI 
    const txtP = new JTextField("0.0", 5);
    const txtA = new JTextField("0.0", 5);
    const spP  = new JSpinner(new SpinnerNumberModel(0.5, 0.01, 5.0, 0.05));
    const spA  = new JSpinner(new SpinnerNumberModel(0.5, 0.01, 5.0, 0.05));

    const dialog = new JDialog(MainApplication.getMainFrame(), "Ajuste de grade", false);
    const panel  = new JPanel(new GridBagLayout());
    const gbc    = new GridBagConstraints();
    gbc.insets   = new Insets(5, 5, 5, 5);

    function bloco(tit, txt, sp, row) {
        let p = new JPanel(new GridBagLayout());
        p.setBorder(BorderFactory.createTitledBorder(tit));
        let bc = new GridBagConstraints();
        bc.insets = new Insets(2, 2, 2, 2);
        let bM = new JButton("-"), bP = new JButton("+");
        bM.setPreferredSize(new Dimension(45, 25));
        bP.setPreferredSize(new Dimension(45, 25));
        bc.gridx = 0; bc.gridy = 0;
        p.add(new JLabel("Distância (m):"), bc);
        bc.gridx = 1; p.add(txt, bc);
        bc.gridx = 0; bc.gridy = 1;
        let pb = new JPanel(); pb.add(bM); pb.add(bP);
        p.add(pb, bc);
        bc.gridx = 1; p.add(sp, bc);
        bP.addActionListener(new ActionListener({ actionPerformed: function() {
            txt.setText((parseFloat(txt.getText()) + parseFloat(sp.getValue())).toFixed(2));
            aplicarDireto();
        }}));
        bM.addActionListener(new ActionListener({ actionPerformed: function() {
            txt.setText((parseFloat(txt.getText()) - parseFloat(sp.getValue())).toFixed(2));
            aplicarDireto();
        }}));
        gbc.gridy = row;
        panel.add(p, gbc);
    }

    bloco("Colunas (Lateral)", txtP, spP, 0);
    bloco("Linhas (Frontal)",  txtA, spA, 1);

    const footer = new JPanel();
    const btnOk  = new JButton("OK",       UIManager.getIcon("OptionPane.yesIcon"));
    const btnCan = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));

    // Intercepta Ctrl+Z enquanto o diálogo está aberto
    const ctrlZDispatcher = new KeyEventDispatcher({
        dispatchKeyEvent: function(e) {
            if (e.getID() === KeyEvent.KEY_PRESSED &&
                e.getKeyCode() === KeyEvent.VK_Z &&
                (e.getModifiersEx() & KeyEvent.CTRL_DOWN_MASK) !== 0) {
                restaurarOriginais();
                new Notification("Ajuste de grade cancelado.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                cleanup();
                return true; // consome o evento — impede o JOSM de processar seu próprio Ctrl+Z
            }
            return false;
        }
    });
    KeyboardFocusManager.getCurrentKeyboardFocusManager().addKeyEventDispatcher(ctrlZDispatcher);

    let isCleanedUp = false;
    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        try {
            KeyboardFocusManager.getCurrentKeyboardFocusManager().removeKeyEventDispatcher(ctrlZDispatcher);
        } catch(e) {}

        if (dialog) {
            try {
                const listeners = dialog.getWindowListeners();
                for (let i = 0; i < listeners.length; i++) {
                    dialog.removeWindowListener(listeners[i]);
                }
            } catch(e) {}
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

    btnOk.addActionListener(new ActionListener({ actionPerformed: function() {
        confirmarNoHistorico();
        new Notification("Grade finalizada com sucesso.")
            .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        cleanup();
    }}));

    btnCan.addActionListener(new ActionListener({ actionPerformed: function() {
        restaurarOriginais();
        new Notification("Ajuste de grade cancelado.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        cleanup();
    }}));

    dialog.addWindowListener(new WindowAdapter({ windowClosing: function() {
        restaurarOriginais();
        cleanup();
    }}));

    footer.add(btnOk);
    footer.add(btnCan);
    dialog.add(panel,  BorderLayout.CENTER);
    dialog.add(footer, BorderLayout.SOUTH);
    dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
}