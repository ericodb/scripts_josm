"use strict";

const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const MoveCommand     = Java.type("org.openstreetmap.josm.command.MoveCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager       = Java.type("javax.swing.UIManager");
const JDialog         = Java.type("javax.swing.JDialog");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JButton         = Java.type("javax.swing.JButton");
const JSpinner        = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const Timer           = Java.type("javax.swing.Timer");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const SwingUtilities  = Java.type("javax.swing.SwingUtilities");
const Box             = Java.type("javax.swing.Box");
const ArrayList       = Java.type("java.util.ArrayList");
const Float           = Java.type("java.lang.Float");
const BorderLayout    = Java.type("java.awt.BorderLayout");
const Color           = Java.type("java.awt.Color");
const BasicStroke     = Java.type("java.awt.BasicStroke");
const RenderingHints  = Java.type("java.awt.RenderingHints");
const WindowListener  = Java.type("java.awt.event.WindowListener");
const MouseListener   = Java.type("java.awt.event.MouseListener");
const Font            = Java.type("java.awt.Font");
const GradientPaint   = Java.type("java.awt.GradientPaint");
const RoundRectangle2D = Java.type("java.awt.geom.RoundRectangle2D");
const Area            = Java.type("java.awt.geom.Area");
const GeneralPath     = Java.type("java.awt.geom.GeneralPath");

(function() {
    const currentLayer = MainApplication.getLayerManager().getEditLayer();
    if (!currentLayer) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    let dialog = null;
    let isCleanedUp = false;

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
            try { dialog.dispose(); } catch(e) {}
            dialog = null;
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

    const initialPositions = new Map();
    let movimentosAcumulados = 0;
    let anguloAtualRad = 0.0;
    let setaPressionada = -1;
    let lblAnguloTexto;

    // Dimensões do D-pad
    const ARM_LEN  = 66;   // comprimento do braço
    const ARM_W    = 28;   // largura do braço
    const HALF_W   = ARM_W / 2;
    const R_CENTER = 19;   // raio botão central
    const ARC      = 10;   // arredondamento das pontas

    function atualizarLabelAngulo() {
        if (!lblAnguloTexto) return;
        let graus = Math.round(anguloAtualRad * (180.0 / Math.PI));
        graus = -graus; 
        if (graus < 0) graus += 360;
        lblAnguloTexto.setText(
            "<html><div style='text-align:center;color:#888;font-size:10px;'>" +
            "Ângulo: <b style='color:#e65100;font-size:11px;'>" + graus + "°</b></div></html>");
    }

    function recalcularAnguloSelecao() {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer) return false;
        const nodes = layer.data.getSelectedNodes();
        if (nodes && nodes.size() >= 2) {
            const it = nodes.iterator();
            const n1 = it.next(), n2 = it.next();
            const c1 = n1.getCoor(), c2 = n2.getCoor();
            const latRad = ((c1.lat() + c2.lat()) / 2.0) * (Math.PI / 180.0);
            const mPerDegLat = 111319.492;
            const mPerDegLon = mPerDegLat * Math.cos(latRad);
            const dxM = (c2.lon() - c1.lon()) * mPerDegLon;
            const dyM = (c2.lat() - c1.lat()) * mPerDegLat;
            const comp = Math.sqrt(dxM * dxM + dyM * dyM);
            if (comp > 1e-6) {
                anguloAtualRad = Math.atan2(-dyM, dxM);
                atualizarLabelAngulo();
                return true;
            }
        }
        return false;
    }

    function getValorSpinner() {
        try { spinner.commitEdit(); } catch(e) {}
        return model.getValue();
    }

    const moverNósSelecao = function(distancia, alpha) {
        try {
            const layer = MainApplication.getLayerManager().getEditLayer();
            if (!layer) return;
            const nodes = layer.data.getSelectedNodes();
            if (!recalcularAnguloSelecao() || nodes.isEmpty()) {
                new Notification("Selecione pelo menos 2 nós no mapa.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                return;
            }
            const mx2 = Math.cos(alpha);
            const my2 = -Math.sin(alpha);
            const scale = 1.0 / Math.cos(nodes.iterator().next().getCoor().lat() * Math.PI / 180.0);
            const cmds = new ArrayList();
            const itAll = nodes.iterator();
            while (itAll.hasNext()) {
                const n = itAll.next();
                if (!initialPositions.has(n)) initialPositions.set(n, n.getEastNorth());
                cmds.add(new MoveCommand(n, mx2 * distancia * scale, my2 * distancia * scale));
            }
            UndoRedoHandler.getInstance().add(new SequenceCommand("Ajuste Fino Direcional", cmds));
            movimentosAcumulados++;
        } catch (e) {
            new Notification("Erro: " + e).setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        }
    };

    // Rotaciona o ponto para o referencial do braço solicitado
    function pontoNoBraco(lx, ly, id) {
        let angle = 0;
        if (id === 0) angle = Math.PI / 2;   // Cima
        else if (id === 1) angle = -Math.PI / 2; // Baixo
        else if (id === 2) angle = Math.PI;  // Trás
        // id===3: Frente, angle=0

        const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
        const rx = lx * cosA - ly * sinA;
        const ry = lx * sinA + ly * cosA;

        return rx >= HALF_W && rx <= ARM_LEN && Math.abs(ry) <= HALF_W;
    }

    // Constrói o path de um braço com ponta arredondada (apenas as duas pontas do fim)
    function buildArmPath(g2d) {
        const p = new GeneralPath();
        p.moveTo(HALF_W, -HALF_W);
        p.lineTo(ARM_LEN - ARC, -HALF_W);
        p.quadTo(ARM_LEN, -HALF_W, ARM_LEN, -HALF_W + ARC);
        p.lineTo(ARM_LEN, HALF_W - ARC);
        p.quadTo(ARM_LEN, HALF_W, ARM_LEN - ARC, HALF_W);
        p.lineTo(HALF_W, HALF_W);
        p.closePath();
        return p;
    }

    const JPanelExtended = Java.extend(JPanel);
    const controlePanel = new JPanelExtended({
        getPreferredSize: function() { return new (Java.type("java.awt.Dimension"))(140, 140); },
        getMinimumSize:   function() { return new (Java.type("java.awt.Dimension"))(140, 140); },
        paintComponent: function(g) {
            Java.super(controlePanel).paintComponent(g);
            const g2d = g;
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2d.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);

            const cx = controlePanel.getWidth() / 2;
            const cy = controlePanel.getHeight() / 2;

            g2d.translate(cx, cy);
            g2d.rotate(anguloAtualRad);

            // Quatro braços
            const DIRS = [
                { id: 3, angle: 0,              label: "Frente" },
                { id: 0, angle: Math.PI / 2,    label: "Cima"   },
                { id: 2, angle: Math.PI,         label: "Trás"   },
                { id: 1, angle: -Math.PI / 2,   label: "Baixo"  }
            ];

            DIRS.forEach(function(dir) {
                g2d.rotate(dir.angle);
                const arm = buildArmPath(g2d);

                // Gradiente do braço: base mais escura, ponta mais clara
                const pressed = (setaPressionada === dir.id);
                const colBase = pressed ? new Color(140, 190,  255)  : new Color(45, 48, 50);
                const colTip  = pressed ? new Color(80, 140, 255) : new Color(75, 78, 82);
                const gp = new GradientPaint(HALF_W, 0, colBase, ARM_LEN, 0, colTip);
                g2d.setPaint(gp);
                g2d.fill(arm);

                // Borda fina
                g2d.setColor(pressed ? new Color(180, 60, 0) : new Color(30, 30, 30));
                g2d.setStroke(new BasicStroke(Float.parseFloat("1.2")));
                g2d.draw(arm);

                // Seta triangular na ponta
                const tx = ARM_LEN - 14;
                const arrowSize = 7;
                const ap = new GeneralPath();
                ap.moveTo(tx + arrowSize, 0);
                ap.lineTo(tx - arrowSize / 2, -arrowSize);
                ap.lineTo(tx - arrowSize / 2,  arrowSize);
                ap.closePath();
                g2d.setColor(pressed ? new Color(255, 255, 200) : new Color(220, 220, 220));
                g2d.fill(ap);

                g2d.rotate(-dir.angle);
            });

            // Botão central
            const pressedC = (setaPressionada === 99);
            const gcBase = pressedC ? new Color(80, 140, 255) : new Color(45, 48, 50);
            const gcTip  = pressedC ? new Color(140, 190, 255): new Color(75, 78, 82);
            g2d.setPaint(new GradientPaint(-R_CENTER, -R_CENTER, gcBase, R_CENTER, R_CENTER, gcTip));
            g2d.fillOval(-R_CENTER, -R_CENTER, R_CENTER * 2, R_CENTER * 2);
            g2d.setColor(pressedC ? new Color(50, 100, 200) : new Color(25, 25, 25));
            g2d.setStroke(new BasicStroke(Float.parseFloat("1.2")));
            g2d.drawOval(-R_CENTER, -R_CENTER, R_CENTER * 2, R_CENTER * 2);

            // Ícone 🔄 no centro
            g2d.setFont(new Font("Dialog", Font.PLAIN, 15));
            const fm = g2d.getFontMetrics();
            const txt = "🔄️";
            g2d.setColor(Color.WHITE);
            g2d.drawString(txt, -fm.stringWidth(txt) / 2, fm.getAscent() / 2 - 1);
 
            g2d.rotate(-anguloAtualRad);
            g2d.translate(-cx, -cy);

            atualizarLabelAngulo();
        }
    });

    controlePanel.setOpaque(false);

    const MouseListenerExtended = Java.extend(MouseListener);
    controlePanel.addMouseListener(new MouseListenerExtended({
        mouseClicked: function(e) {
            const cx = controlePanel.getWidth() / 2;
            const cy = controlePanel.getHeight() / 2;
            const dx = e.getX() - cx;
            const dy = e.getY() - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Botão central
            if (dist <= R_CENTER + 2) {
                setaPressionada = 99;
                controlePanel.repaint();
                if (!recalcularAnguloSelecao()) {
                    new Notification("Nenhum segmento válido para sincronia.")
                        .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                }
                const t = new Timer(150, function() { setaPressionada = -1; controlePanel.repaint(); });
                t.setRepeats(false); t.start();
                return;
            }

            // Converte clique para o sistema local (rotacionado)
            const cosA = Math.cos(-anguloAtualRad), sinA = Math.sin(-anguloAtualRad);
            const lx = dx * cosA - dy * sinA;
            const ly = dx * sinA + dy * cosA;

            // Testa cada braço com geometria precisa
            let hitId = -1, hitAlpha = 0;
            const DIRS = [
                { id: 3, angle: 0,              alpha: anguloAtualRad },
                { id: 0, angle: Math.PI / 2,    alpha: anguloAtualRad + Math.PI / 2 },
                { id: 2, angle: Math.PI,         alpha: anguloAtualRad + Math.PI },
                { id: 1, angle: -Math.PI / 2,   alpha: anguloAtualRad - Math.PI / 2 }
            ];

            for (let i = 0; i < DIRS.length; i++) {
                const dir = DIRS[i];
                // Rotaciona o ponto local para o referencial do braço
                const ca = Math.cos(-dir.angle), sa = Math.sin(-dir.angle);
                const bx = lx * ca - ly * sa;
                const by = lx * sa + ly * ca;
                // O braço vai de HALF_W a ARM_LEN em X e -HALF_W a HALF_W em Y
                if (bx >= HALF_W - 2 && bx <= ARM_LEN + 2 && Math.abs(by) <= HALF_W + 2) {
                    hitId = dir.id;
                    hitAlpha = dir.alpha;
                    break;
                }
            }

            if (hitId === -1) return; // clique fora de qualquer braço

            setaPressionada = hitId;
            controlePanel.repaint();
            moverNósSelecao(getValorSpinner(), hitAlpha);
            const t = new Timer(150, function() { setaPressionada = -1; controlePanel.repaint(); });
            t.setRepeats(false); t.start();
        },
        mousePressed:  function(e) {},
        mouseReleased: function(e) {},
        mouseEntered:  function(e) {},
        mouseExited:   function(e) {}
    }));

    // Interface
    dialog = new JDialog(MainApplication.getMainFrame(), "Mover Nós Selecionados", false);
    const mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(8, 8, 4, 8));

    const model = new SpinnerNumberModel(1.0, 0.0, 100.0, 0.5);
    const spinner = new JSpinner(model);
    spinner.setPreferredSize(new (Java.type("java.awt.Dimension"))(70, 24));

    const sP = new JPanel();
    sP.setOpaque(false);
    sP.add(new JLabel("Passo (m):"));
    sP.add(spinner);
    mainPanel.add(sP);
    mainPanel.add(Box.createVerticalStrut(2));

    const centerContainer = new JPanel(new BorderLayout());
    centerContainer.setOpaque(false);
    centerContainer.add(controlePanel, BorderLayout.CENTER);
    mainPanel.add(centerContainer);
    mainPanel.add(Box.createVerticalStrut(2));

    recalcularAnguloSelecao();

    const WindowListenerExtended = Java.extend(WindowListener);
    dialog.addWindowListener(new WindowListenerExtended({
        windowActivated: function(e) {
            SwingUtilities.invokeLater(function() {
                if (recalcularAnguloSelecao()) mainPanel.repaint();
            });
        },
        windowClosed: function(e) { cleanup(); }, windowClosing: function(e) { cleanup(); },
        windowDeactivated: function(e) {}, windowIconified: function(e) {},
        windowDeiconified: function(e) {}, windowOpened: function(e) {}
    }));

    const anguloPanel = new JPanel();
    anguloPanel.setOpaque(false);
    lblAnguloTexto = new JLabel();
    atualizarLabelAngulo(); 
    anguloPanel.add(lblAnguloTexto);

    const footer = new JPanel();
    footer.setOpaque(false);
    const btnOk = new JButton("Concluir", UIManager.getIcon("OptionPane.okIcon"));
    const btnCc = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));

    btnOk.addActionListener(function() {
        new Notification(movimentosAcumulados > 0
            ? movimentosAcumulados + " ajuste(s) aplicado(s)."
            : "Nenhuma alteração realizada."
        ).setIcon(UIManager.getIcon(movimentosAcumulados > 0
            ? "OptionPane.informationIcon" : "OptionPane.warningIcon")).show();
        cleanup();
    });

    btnCc.addActionListener(function() {
        if (movimentosAcumulados > 0) {
            for (let i = 0; i < movimentosAcumulados; i++) UndoRedoHandler.getInstance().undo();
            new Notification("Cancelado: alterações revertidas.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Operação cancelada.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
        cleanup();
    });

    footer.add(btnOk);
    footer.add(btnCc);

    const painelInf = new JPanel();
    painelInf.setLayout(new BoxLayout(painelInf, BoxLayout.Y_AXIS));
    painelInf.setOpaque(false);
    painelInf.add(anguloPanel);
    painelInf.add(footer);

    const content = new JPanel(new BorderLayout());
    content.add(mainPanel, BorderLayout.CENTER);
    content.add(painelInf,  BorderLayout.SOUTH);

    dialog.setContentPane(content);
    dialog.pack();
    dialog.setResizable(false);
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
})();