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
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const BorderLayout    = Java.type("java.awt.BorderLayout");
const ArrayList       = Java.type("java.util.ArrayList");
const Box             = Java.type("javax.swing.Box");
const Color           = Java.type("java.awt.Color");
const BasicStroke     = Java.type("java.awt.BasicStroke");
const RenderingHints  = Java.type("java.awt.RenderingHints");
const SwingUtilities  = Java.type("javax.swing.SwingUtilities");
const WindowListener  = Java.type("java.awt.event.WindowListener");
const MouseListener   = Java.type("java.awt.event.MouseListener");
const Polygon         = Java.type("java.awt.Polygon");
const Timer           = Java.type("javax.swing.Timer");

(function() {
    const currentLayer = MainApplication.getLayerManager().getEditLayer();
    if (!currentLayer) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    const initialPositions = new Map();
    let movimentosAcumulados = 0;
    let anguloAtualRad = 0.0;
    let setaPressionada = -1;
    let lblAnguloTexto;

    const SETAS = [
        { id: 0, anguloFn: function() { return anguloAtualRad + Math.PI / 2; }, tipo: "p", direcao:   1 }, // cima
        { id: 1, anguloFn: function() { return anguloAtualRad - Math.PI / 2; }, tipo: "p", direcao:  -1 }, // baixo
        { id: 2, anguloFn: function() { return anguloAtualRad + Math.PI;     }, tipo: "t", direcao:   1 }, // trás
        { id: 3, anguloFn: function() { return anguloAtualRad;               }, tipo: "t", direcao:  -1 }  // frente
    ];

    function atualizarLabelAngulo() {
        if (!lblAnguloTexto) return;
        let graus = Math.round(anguloAtualRad * (180.0 / Math.PI));
        graus = -graus; 
        if (graus < 0) graus += 360;

        lblAnguloTexto.setText("<html><div style='text-align: center; color: #555555; font-size: 10px;'>" +
                               "Ângulo do Segmento: <b style='color: #e65100; font-size: 11px;'>" + graus + "°</b></div></html>");
    }

    function recalcularAnguloSelecao() {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer) return false;
        const nodes = layer.data.getSelectedNodes();
        if (nodes && nodes.size() >= 2) {
            const it = nodes.iterator();
            const n1 = it.next();
            const n2 = it.next();
            const c1 = n1.getCoor();
            const c2 = n2.getCoor();
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

    const moverNósSelecao = function(distancia, tipo, direcao) {
        try {
            const layer = MainApplication.getLayerManager().getEditLayer();
            if (!layer) return;
            const nodes = layer.data.getSelectedNodes();
            if (!recalcularAnguloSelecao() || nodes.isEmpty()) {
                new Notification("Ação bloqueada: Selecione pelo menos 2 nós no mapa.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                return;
            }

            const anguloGeo = -anguloAtualRad;
            let anguloFinal = anguloGeo - Math.PI / 2; 

            if (tipo === "p") {
                anguloFinal += (direcao === 1) ? Math.PI / 2 : -Math.PI / 2;
            } else {
                if (direcao === -1) anguloFinal += Math.PI;
            }

            const mx2 = Math.cos(anguloFinal);
            const my2 = Math.sin(anguloFinal);
            const scale = 1.0 / Math.cos(nodes.iterator().next().getCoor().lat() * Math.PI / 180.0);
            const dEnX = mx2 * distancia * scale;
            const dEnY = my2 * distancia * scale;
            const cmds = new ArrayList();
            const itAll = nodes.iterator();
            while (itAll.hasNext()) {
                const n = itAll.next();
                if (!initialPositions.has(n)) initialPositions.set(n, n.getEastNorth());
                cmds.add(new MoveCommand(n, dEnX, dEnY));
            }
            UndoRedoHandler.getInstance().add(new SequenceCommand("Ajuste Fino Direcional", cmds));
            movimentosAcumulados++;
        } catch (e) {
            new Notification("Erro na operação: " + e)
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        }
    };

    function difAngulo(a, b) {
        let diff = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        return diff > Math.PI ? 2 * Math.PI - diff : diff;
    }

    function detectarSeta(mx, my, cx, cy, r) {
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rSeta = r + 14;
        if (dist < r + 2 || dist > rSeta + 16) return null;

        const anguloClique = Math.atan2(dy, dx) + Math.PI / 2;

        let melhor = null;
        let menorD = Math.PI / 4;
        for (let i = 0; i < SETAS.length; i++) {
            const d = difAngulo(anguloClique, SETAS[i].anguloFn());
            if (d < menorD) { menorD = d; melhor = SETAS[i]; }
        }
        return melhor;
    }

    const JPanelExtended = Java.extend(JPanel);
    const controlePanel = new JPanelExtended({
        getPreferredSize: function() {
            return new (Java.type("java.awt.Dimension"))(160, 160);
        },
        getMinimumSize: function() {
            return new (Java.type("java.awt.Dimension"))(160, 160);
        },
        paintComponent: function(g) {
            Java.super(controlePanel).paintComponent(g);
            const g2d = g;
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

            const w = controlePanel.getWidth();
            const h = controlePanel.getHeight();
            const cx = w / 2;
            const cy = h / 2;
            const r = 42;
            const rSeta = r + 14;

            g2d.setColor(Color.WHITE);
            g2d.setStroke(new BasicStroke(1));
            g2d.drawOval(cx - r, cy - r, r * 2, r * 2);

            g2d.setColor(new Color(190, 190, 190));
            g2d.setStroke(new BasicStroke(1));
            g2d.drawLine(cx - r, cy, cx + r, cy);
            g2d.drawLine(cx, cy - r, cx, cy + r);

            const cosA = Math.cos(anguloAtualRad);
            const sinA = Math.sin(anguloAtualRad);
            g2d.setColor(Color.RED);
            g2d.setStroke(new BasicStroke(5));
            g2d.drawLine(
                Math.round(cx - r * cosA), Math.round(cy - r * sinA),
                Math.round(cx + r * cosA), Math.round(cy + r * sinA)
            );

            for (let i = 0; i < SETAS.length; i++) {
                const s = SETAS[i];
                const pressionada = (s.id === setaPressionada);
                const ang = s.anguloFn();

                g2d.translate(cx, cy);
                g2d.rotate(ang);
                const base = -Math.round(rSeta);

                // Fundo arredondado (estilo botão)
                const bx = -9;
                const by = base - 6;
                const bw = 18;
                const bh = 16;
                const arc = 6;
                
                g2d.setColor(pressionada ? new Color(100, 160, 255) : new Color(65, 65, 65));
                g2d.fillRoundRect(bx, by, bw, bh, arc, arc);
                g2d.setColor(pressionada ? new Color(50, 100, 200) : new Color(130, 130, 130));
                g2d.setStroke(new BasicStroke(pressionada ? 2.0 : 1.0));
                g2d.drawRoundRect(bx, by, bw, bh, arc, arc);
 
                // Triângulo
                const p = new Polygon();
                p.addPoint(0,  base - 3);
                p.addPoint(5,  base + 6);
                p.addPoint(-5, base + 6);
                g2d.setColor(pressionada ? new Color(255, 255, 255) : new Color(200, 200, 200));
                g2d.fillPolygon(p);

                g2d.rotate(-ang);
                g2d.translate(-cx, -cy);
            }
            atualizarLabelAngulo();
        }
    });

    controlePanel.setOpaque(false);

    const MouseListenerExtended = Java.extend(MouseListener);
    controlePanel.addMouseListener(new MouseListenerExtended({
        mouseClicked: function(e) {
            const cx = controlePanel.getWidth() / 2;
            const cy = controlePanel.getHeight() / 2;
            const seta = detectarSeta(e.getX(), e.getY(), cx, cy, 42);
            if (!seta) return;

            setaPressionada = seta.id;
            controlePanel.repaint();

            moverNósSelecao(getValorSpinner(), seta.tipo, seta.direcao);

            const t = new Timer(150, function(_e) { setaPressionada = -1; controlePanel.repaint(); });
            t.setRepeats(false);
            t.start();
        },
        mousePressed:  function(e) {},
        mouseReleased: function(e) {},
        mouseEntered:  function(e) {},
        mouseExited:   function(e) {}
    }));

    const dialog = new JDialog(MainApplication.getMainFrame(), "Move nós Selecionados", false);
    const mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
    mainPanel.setBackground(UIManager.getColor("Panel.background"));

    const model = new SpinnerNumberModel(1.0, 0.0, 100.0, 0.5);
    const spinner = new JSpinner(model);

    const btnSync = new JButton("🔄");
    btnSync.setToolTipText("Sincronizar ângulo com seleção atual");
    btnSync.addActionListener(function() {
        if (!recalcularAnguloSelecao()) {
            new Notification("Nenhum segmento válido selecionado para sincronia.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
        mainPanel.repaint();
    });

    const sP = new JPanel();
    sP.setOpaque(false);
    sP.add(new JLabel("Passo (m):"));
    sP.add(spinner);
    sP.add(btnSync);
    mainPanel.add(sP);
    mainPanel.add(Box.createVerticalStrut(5));

    const centerContainer = new JPanel(new BorderLayout());
    centerContainer.setOpaque(false);
    centerContainer.add(controlePanel, BorderLayout.CENTER);
    mainPanel.add(centerContainer);
    mainPanel.add(Box.createVerticalStrut(5));

    recalcularAnguloSelecao();

    const WindowListenerExtended = Java.extend(WindowListener);
    dialog.addWindowListener(new WindowListenerExtended({
        windowActivated: function(e) {
            SwingUtilities.invokeLater(function() {
                if (recalcularAnguloSelecao()) mainPanel.repaint();
            });
        },
        windowClosed:      function(e) {},
        windowClosing:     function(e) {},
        windowDeactivated: function(e) {},
        windowIconified:   function(e) {},
        windowDeiconified: function(e) {},
        windowOpened:      function(e) {}
    }));

    // Painel para o texto em HTML do ângulo
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
        if (movimentosAcumulados > 0) {
            new Notification(movimentosAcumulados + " ajuste(s) aplicado(s) com sucesso.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Nenhuma alteração foi realizada.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
        dialog.dispose();
    });

    // Reverte todas as alterações acumuladas ao cancelar
    btnCc.addActionListener(function() {
        if (movimentosAcumulados > 0) {
            for (let i = 0; i < movimentosAcumulados; i++) {
                UndoRedoHandler.getInstance().undo();
            }
            new Notification("Operação cancelada: todas as alterações foram revertidas.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Operação cancelada.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        }
        dialog.dispose();
    });

    footer.add(btnOk);
    footer.add(btnCc);

    const painelInferiorCompleto = new JPanel();
    painelInferiorCompleto.setLayout(new BoxLayout(painelInferiorCompleto, BoxLayout.Y_AXIS));
    painelInferiorCompleto.setOpaque(false);
    painelInferiorCompleto.add(anguloPanel);
    painelInferiorCompleto.add(footer);

    const content = new JPanel(new BorderLayout());
    content.add(mainPanel, BorderLayout.CENTER);
    content.add(painelInferiorCompleto, BorderLayout.SOUTH);

    dialog.setContentPane(content);
    dialog.pack();
    dialog.setResizable(false);
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
})();