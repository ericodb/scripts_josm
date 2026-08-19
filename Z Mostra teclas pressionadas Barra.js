"use strict";

import { addResetCallback } from 'josm/context';

// IMPORTS
const MainApplication        = Java.type("org.openstreetmap.josm.gui.MainApplication");
const JDialog                = Java.type("javax.swing.JDialog");
const JLabel                 = Java.type("javax.swing.JLabel");
const JPanel                 = Java.type("javax.swing.JPanel");
const Timer                  = Java.type("javax.swing.Timer");
const Color                  = Java.type("java.awt.Color");
const Font                   = Java.type("java.awt.Font");
const Toolkit                = Java.type("java.awt.Toolkit");
const GraphicsEnvironment     = Java.type("java.awt.GraphicsEnvironment");
const AWTEvent               = Java.type("java.awt.AWTEvent");
const KeyEvent               = Java.type("java.awt.event.KeyEvent");
const MouseEvent             = Java.type("java.awt.event.MouseEvent");
const WindowEvent            = Java.type("java.awt.event.WindowEvent");
const MouseAdapter           = Java.extend(Java.type("java.awt.event.MouseAdapter"));
const MouseMotionAdapter     = Java.extend(Java.type("java.awt.event.MouseMotionAdapter"));
const AWTEventListener       = Java.extend(Java.type("java.awt.event.AWTEventListener"));
const ActionListener         = Java.extend(Java.type("java.awt.event.ActionListener"));
const PropertyChangeListener = Java.extend(Java.type("java.beans.PropertyChangeListener"));
const KeyboardFocusManager   = Java.type("java.awt.KeyboardFocusManager");
const KeyEventDispatcher     = Java.extend(Java.type("java.awt.KeyEventDispatcher"));
const LineBorder             = Java.type("javax.swing.border.LineBorder");

(function() {
    const CENTER_ALIGN = 0;

    // Paleta Dark HUD
    const COR_FUNDO_PAINEL = new Color(42, 80, 116);       // Dark Slate (Azul Fundo)
    const COR_BORDA_PAINEL = new Color(97, 99, 101);       // Borda Slate
    
    const COR_INATIVO_BG   = new Color(60, 63, 65);       // Fundo Tecla Inativa
    const COR_INATIVO_FG   = new Color(148, 163, 184);    // Texto Inativo
    const COR_INATIVO_BD   = new Color(71, 85, 105);      // Borda Inativa

    const COR_ATIVO_BG     = new Color(30, 58, 138);      // Fundo Tecla Ativa (Azul)
    const COR_ATIVO_FG     = new Color(248, 250, 252);    // Texto Ativo
    const COR_ATIVO_BD     = new Color(59, 130, 246);      // Borda Ativa (Azul Neon)

    const v = {
        lmb: false, rmb: false, alt: false, ctrl: false, shift: false, tecla: "", lastCode: null,
        keyDispatcher: null, mouseListener: null, activeWindowListener: null,

        // Inicialização: cria o diálogo, labels, listener e timer
        init: function() {
            this.dialog = new JDialog(MainApplication.getMainFrame(), false);
            this.dialog.setUndecorated(true);
            this.dialog.setSize(530, 48);
            this.dialog.setAutoRequestFocus(false);
            this.dialog.setFocusableWindowState(false);

            const mainPanel = new JPanel();
            mainPanel.setLayout(null);
            mainPanel.setBackground(COR_FUNDO_PAINEL);
            mainPanel.setBorder(new LineBorder(COR_BORDA_PAINEL, 2, true));
            this.dialog.setContentPane(mainPanel);

            const screen = GraphicsEnvironment.getLocalGraphicsEnvironment()
                .getDefaultScreenDevice().getDefaultConfiguration().getBounds();
            const posX = Math.floor((screen.width * 6 / 10) - (this.dialog.getWidth() / 2));
            const posY = Math.floor(screen.height - this.dialog.getHeight() - 70);
            this.dialog.setLocation(posX, posY);

            this.lblLmb   = this.criarLabel(8, 48);
            this.lblRmb   = this.criarLabel(60, 48);
            this.lblAlt   = this.criarLabel(114, 52);
            this.lblCtrl  = this.criarLabel(170, 54);
            this.lblShift = this.criarLabel(228, 62);
            this.lblTecla = this.criarLabel(294, 192);

            // Botão de fechar (✕)
            this.lblFechar = new JLabel("✕");
            this.lblFechar.setHorizontalAlignment(CENTER_ALIGN);
            this.lblFechar.setBounds(494, 9, 24, 28);
            this.lblFechar.setFont(new Font("Dialog", Font.BOLD, 14));
            this.lblFechar.setForeground(COR_INATIVO_FG);
            this.lblFechar.addMouseListener(new MouseAdapter({
                mouseClicked: (e) => { this.encerrar(); },
                mouseEntered: (e) => { this.lblFechar.setForeground(new Color(239, 68, 68)); },
                mouseExited:  (e) => { this.lblFechar.setForeground(COR_INATIVO_FG); }
            }));
            mainPanel.add(this.lblFechar);

            // Timer para limpar teclas modificadoras após 1s sem atividade
            this.timer = new Timer(1000, new ActionListener({
                actionPerformed: (e) => {
                    this.alt = false; this.ctrl = false; this.shift = false; this.tecla = ""; this.lastCode = null;
                    this.atualizarLabels();
                }
            }));
            this.timer.setRepeats(false);

            this.keyDispatcher = new KeyEventDispatcher({
                dispatchKeyEvent: (event) => {
                    this.handleKeyEvent(event);
                    return false;
                }
            });
            KeyboardFocusManager.getCurrentKeyboardFocusManager().addKeyEventDispatcher(this.keyDispatcher);

            // Listener de ativação de janela para alternar setAlwaysOnTop dinamicamente
            this.activeWindowListener = new PropertyChangeListener({
                propertyChange: (evt) => {
                    this.atualizarOnTop();
                }
            });
            KeyboardFocusManager.getCurrentKeyboardFocusManager().addPropertyChangeListener("activeWindow", this.activeWindowListener);

            // Listener global de teclado, mouse e janelas via Toolkit
            this.mouseListener = new AWTEventListener({
                eventDispatched: (event) => {
                    if (event instanceof MouseEvent) {
                        this.handleMouseEvent(event);
                    } else if (event instanceof WindowEvent) {
                        this.handleWindowEvent(event);
                    }
                }
            });
            Toolkit.getDefaultToolkit().addAWTEventListener(
                this.mouseListener,
                AWTEvent.MOUSE_EVENT_MASK | AWTEvent.WINDOW_EVENT_MASK | AWTEvent.WINDOW_FOCUS_EVENT_MASK
            );

            // Arrastar o diálogo pela janela
            let pontoInicial = null;
            mainPanel.addMouseListener(new MouseAdapter({
                mousePressed: (e) => { pontoInicial = e.getPoint(); }
            }));
            mainPanel.addMouseMotionListener(new MouseMotionAdapter({
                mouseDragged: (e) => {
                    const ponto = e.getLocationOnScreen();
                    this.dialog.setLocation(
                        Math.floor(ponto.x - (pontoInicial ? pontoInicial.x : 0)),
                        Math.floor(ponto.y - (pontoInicial ? pontoInicial.y : 0))
                    );
                }
            }));

            this.atualizarLabels();
            this.dialog.setVisible(true);
            this.atualizarOnTop();
        },

        // Atualiza a propriedade AlwaysOnTop com base em a aplicação JOSM estar ativa
        atualizarOnTop: function() {
            if (!this.dialog) return;

            const activeWin = KeyboardFocusManager.getCurrentKeyboardFocusManager().getActiveWindow();
            const isJosmActive = (activeWin !== null);

            if (isJosmActive) {
                if (!this.dialog.isAlwaysOnTop()) {
                    this.dialog.setAlwaysOnTop(true);
                }
                this.dialog.toFront();
            } else {
                if (this.dialog.isAlwaysOnTop()) {
                    this.dialog.setAlwaysOnTop(false);
                }
            }
        },

        // Limpeza: remove listeners, para o timer e fecha o diálogo
        encerrar: function() {
            if (this.timer) this.timer.stop();
            if (this.keyDispatcher) {
                KeyboardFocusManager.getCurrentKeyboardFocusManager().removeKeyEventDispatcher(this.keyDispatcher);
                this.keyDispatcher = null;
            }
            if (this.activeWindowListener) {
                KeyboardFocusManager.getCurrentKeyboardFocusManager().removePropertyChangeListener("activeWindow", this.activeWindowListener);
                this.activeWindowListener = null;
            }
            if (this.mouseListener) {
                Toolkit.getDefaultToolkit().removeAWTEventListener(this.mouseListener);
                this.mouseListener = null;
            }
            if (this.dialog) {
                this.dialog.setAlwaysOnTop(false);
                this.dialog.dispose();
                this.dialog = null;
            }
        },

        // Cria um label estilizado e o adiciona ao diálogo
        criarLabel: function(x, largura) {
            const lbl = new JLabel("");
            lbl.setOpaque(true);
            lbl.setHorizontalAlignment(CENTER_ALIGN);
            lbl.setBounds(Math.floor(x || 0), 7, Math.floor(largura || 50), 34);
            lbl.setFont(new Font("Dialog", Font.BOLD, 16));
            this.dialog.getContentPane().add(lbl);
            return lbl;
        },

        // Atualiza todos os labels com o estado atual
        obterNomeCurtoTecla: function(code) {
            const mapaTeclas = {
                [KeyEvent.VK_ESCAPE]:     "Esc",
                [KeyEvent.VK_DELETE]:     "Del",
                [KeyEvent.VK_INSERT]:     "Ins",
                [KeyEvent.VK_BACK_SPACE]: "Backspace",
                [KeyEvent.VK_PAGE_UP]:    "PgUp",
                [KeyEvent.VK_PAGE_DOWN]:  "PgDn",
                [KeyEvent.VK_HOME]:       "Home",
                [KeyEvent.VK_END]:        "End",
                [KeyEvent.VK_CAPS_LOCK]:  "Caps",
                [KeyEvent.VK_TAB]:        "Tab",
                [KeyEvent.VK_ENTER]:      "Enter",
                [KeyEvent.VK_PRINTSCREEN]:"PrtSc"
            };

            if (mapaTeclas[code]) return mapaTeclas[code];

            const txt = KeyEvent.getKeyText(code);
            if (!txt || txt.toLowerCase().includes("unknown") || txt.toLowerCase().includes("desconhecido")) {
                return "Key " + code;
            }
            return txt.toUpperCase();
        },

        atualizarLabels: function() {
            this.atualizar(this.lblLmb,   "◀",    this.lmb);
            this.atualizar(this.lblRmb,   "▶",    this.rmb);
            this.atualizar(this.lblAlt,   "Alt",   this.alt);
            this.atualizar(this.lblCtrl,  "Ctrl",  this.ctrl);
            this.atualizar(this.lblShift, "Shift", this.shift);
            if (this.lblTecla) {
                const texto = this.tecla || "";
                const len = texto.length;
                const tamFonte = len > 8 ? 13 : (len > 4 ? 15 : 20);
                this.lblTecla.setFont(new Font("Dialog", Font.BOLD, tamFonte));
                this.atualizar(this.lblTecla, texto, !!texto);
            }
        },

        // Aplica cor e borda ao label conforme ativo/inativo
        atualizar: function(lbl, texto, ativo) {
            if (!lbl) return;
            lbl.setText(texto || "");
            if (ativo) {
                lbl.setBackground(COR_ATIVO_BG);
                lbl.setForeground(COR_ATIVO_FG);
                lbl.setBorder(new LineBorder(COR_ATIVO_BD, 2, true));
            } else {
                lbl.setBackground(COR_INATIVO_BG);
                lbl.setForeground(COR_INATIVO_FG);
                lbl.setBorder(new LineBorder(COR_INATIVO_BD, 1, true));
            }
        },

        // Processa eventos de teclado e mouse capturados globalmente
        handleKeyEvent: function(event) {
            if (!this.dialog || !this.dialog.isVisible()) return;

            const id   = event.getID();
            const code = event.getKeyCode();

            this.alt   = event.isAltDown();
            this.ctrl  = event.isControlDown();
            this.shift = event.isShiftDown();

            if (id === KeyEvent.KEY_PRESSED) {
                const rawChar = String(event.getKeyChar());
                const charCode = rawChar.charCodeAt(0) || 65535;

                if (code === KeyEvent.VK_SPACE) {
                    this.tecla = "Espaço";
                    this.lastCode = code;
                } else if (code >= KeyEvent.VK_NUMPAD0 && code <= KeyEvent.VK_NUMPAD9) {
                    this.tecla = (code - KeyEvent.VK_NUMPAD0).toString();
                    this.lastCode = code;
                } else if (code === KeyEvent.VK_DECIMAL)  { this.tecla = "."; this.lastCode = code; }
                else if (code === KeyEvent.VK_ADD)         { this.tecla = "+"; this.lastCode = code; }
                else if (code === KeyEvent.VK_SUBTRACT)    { this.tecla = "-"; this.lastCode = code; }
                else if (code === KeyEvent.VK_MULTIPLY)    { this.tecla = "*"; this.lastCode = code; }
                else if (code === KeyEvent.VK_DIVIDE)      { this.tecla = "/"; this.lastCode = code; }
                else if (charCode !== 65535 && charCode >= 32 && charCode !== 127) {
                    this.tecla = rawChar.toUpperCase();
                    this.lastCode = code;
                } else if (![KeyEvent.VK_ALT, KeyEvent.VK_CONTROL,
                           KeyEvent.VK_SHIFT, KeyEvent.VK_ALT_GRAPH].includes(code)) {
                    this.tecla = this.obterNomeCurtoTecla(code);
                    this.lastCode = code;
                } else {
                    this.tecla = "";
                    this.lastCode = null;
                }
                this.atualizarLabels();
                if (this.timer) this.timer.restart();

            } else if (id === KeyEvent.KEY_RELEASED) {
                this.atualizarLabels();
            }
        },

        handleMouseEvent: function(event) {
            if (!this.dialog || !this.dialog.isVisible()) return;

            const id = event.getID();
            if (id === MouseEvent.MOUSE_PRESSED) {
                if (event.getButton() === MouseEvent.BUTTON1) this.lmb = true;
                else if (event.getButton() === MouseEvent.BUTTON3) this.rmb = true;
            } else if (id === MouseEvent.MOUSE_RELEASED) {
                if (event.getButton() === MouseEvent.BUTTON1) this.lmb = false;
                else if (event.getButton() === MouseEvent.BUTTON3) this.rmb = false;
            }
            this.atualizarLabels();
            this.atualizarOnTop();
        },

        handleWindowEvent: function(event) {
            if (!this.dialog || !this.dialog.isVisible()) return;

            this.atualizarOnTop();
        }
    };

    // Callback de limpeza chamado pelo plugin ao apertar Reset Context
    addResetCallback(function() {
        v.encerrar();
    });

    v.init();
})();