"use strict";

import { println } from 'josm/scriptingconsole';

// --- IMPORTS JAVA ---
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification = Java.type("org.openstreetmap.josm.gui.Notification");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const ChangePropertyCommand = Java.type("org.openstreetmap.josm.command.ChangePropertyCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const UIManager = Java.type("javax.swing.UIManager");
const ArrayList = Java.type("java.util.ArrayList");

// Swing UI
const JDialog = Java.type("javax.swing.JDialog");
const JPanel = Java.type("javax.swing.JPanel");
const JTextField = Java.type("javax.swing.JTextField");
const JButton = Java.type("javax.swing.JButton");
const JLabel = Java.type("javax.swing.JLabel");
const BoxLayout = Java.type("javax.swing.BoxLayout");
const FlowLayout = Java.type("java.awt.FlowLayout");
const BorderFactory = Java.type("javax.swing.BorderFactory");
const Box = Java.type("javax.swing.Box");
const Robot = Java.type("java.awt.Robot");
const KeyEvent = Java.type("java.awt.event.KeyEvent");
const SwingConstants = Java.type("javax.swing.SwingConstants");

const SwingUtilities  = Java.type("javax.swing.SwingUtilities");
const LayerChangeListener = Java.extend(
    Java.type("org.openstreetmap.josm.gui.layer.LayerManager$LayerChangeListener")
);
const WindowAdapter = Java.extend(Java.type("java.awt.event.WindowAdapter"));

// --- GLOBAL STORAGE ---
let voiceDialog    = null;
let layerListener  = null;
let windowAdapter  = null;
let isCleanedUp    = false;

const cleanup = function() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    if (layerListener) {
        try { MainApplication.getLayerManager().removeLayerChangeListener(layerListener); } catch(e) {}
        layerListener = null;
    }
    if (voiceDialog) {
        if (windowAdapter) {
            try { voiceDialog.removeWindowListener(windowAdapter); } catch(e) {}
            windowAdapter = null;
        }
        try { voiceDialog.dispose(); } catch(e) {}
        voiceDialog = null;
    }
};

if (typeof __josmContextResetHooks__ !== 'undefined') {
    __josmContextResetHooks__.register(cleanup);
}

if (globalThis.__scriptCleanup__) {
    try { globalThis.__scriptCleanup__(); } catch(e) {}
}
globalThis.__scriptCleanup__ = cleanup;

function formatarNome(text) {
    if (!text) return "";
    let cleanText = text.replace(/\s+/g, " ").trim();

    const ignoreWords = new Set(["da", "das", "de", "do", "dos", "e", "com", "em"]);

    const siglas = new Set([
        "br", "sp", "rj", "mg", "rs", "es", "df", "go", "sc", "pr",
        "to", "pi", "pa", "ce", "pe", "ap", "am", "ro", "rr", "ac",
        "ma", "pb", "rn", "ba", "se", "al", "mt", "ms",
        "onu", "ibge", "dnit", "der", "lt", "ld"
    ]);

    // Abreviações expandidas — aplicadas antes do Title Case
    const abreviacoes = {
        "av.":   "Avenida",
        "r.":    "Rua",
        "tv.":   "Travessa",
        "rod.":  "Rodovia",
        "est.":  "Estrada",
        "prof.": "Professor",
        "dr.":   "Doutor",
        "faz.":  "Fazenda"                 
    };

    // Correções de acentuação por busca sem acento
    const correcoes = {
        "conceicao": "Conceição", "sao": "São",    "jose": "José",
        "joao": "João",   "antonio": "Antônio", "vitoria": "Vitória",
        "praca": "Praça", "maria": "Maria",     "francisco": "Francisco",
        "luiz": "Luiz",   "luís": "Luís",       "aparecida": "Aparecida"
    };

    // 1. Expande abreviações antes de processar palavras
    for (const abrev in abreviacoes) {
        const regex = new RegExp("\\b" + abrev.replace(".", "\\.") + "\\s*", "gi");
        cleanText = cleanText.replace(regex, abreviacoes[abrev] + " ");
    }
    cleanText = cleanText.replace(/\s+/g, " ").trim();

    // 2. Processa palavra a palavra com Title Case
    function tratarPalavra(word, isFirst) {
        const original = word.trim();
        if (!original) return "";
        const lower = original.toLowerCase();
        const semAcento = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // Sigla: mantém maiúscula ou detecta padrão tipo BR-101
        const limpo = semAcento.replace(/-/g, "").replace(/_/g, "");
        if (siglas.has(limpo) || /^[a-z]{2,}[-\d]+$/i.test(limpo)) {
            return original.toUpperCase();
        }

        // Correção de acentuação conhecida
        if (correcoes[semAcento]) return correcoes[semAcento];

        // Palavra ignorada (artigo/preposição) — exceto primeira
        if (ignoreWords.has(lower) && !isFirst) return lower;

        // Hífen: trata cada parte recursivamente
        if (original.includes("-")) {
            return original.split("-")
                .map((p, idx) => tratarPalavra(p, idx === 0 && isFirst))
                .join("-");
        }

        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    return cleanText.split(/\s+/).map((w, i) => tratarPalavra(w, i === 0)).join(" ");
}

function mostrarInterfaceVoz() {

    voiceDialog = new JDialog(MainApplication.getMainFrame(), "Correção texto", false);
    const mainPanel = new JPanel();
    mainPanel.setLayout(new BoxLayout(mainPanel, BoxLayout.Y_AXIS));
    mainPanel.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));

    // --- SEÇÃO LOTE ---
    const painelLote = new JPanel(new FlowLayout(FlowLayout.CENTER));
    painelLote.setBorder(BorderFactory.createTitledBorder("Ações em Lote"));
    const btnCorrigirSelecao = new JButton("Corrigir Selecionados");
    btnCorrigirSelecao.addActionListener(() => {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer) { 
            new Notification("Nenhuma camada de edição ativa.")
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show(); 
            return; 
        }
        const selection = layer.data.getSelected();
        if (selection.isEmpty()) {
            new Notification("Selecione objetos no mapa primeiro.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        const tagsAlvo = new Set(["name", "alt_name", "old_name", "official_name", "loc_name", "reg_name"]);
        const commands = new ArrayList();
        const alteracoes = [];
        const it = selection.iterator();
        while (it.hasNext()) {
            const obj = it.next();
            const keys = obj.getKeys();
            for (const entry of keys.entrySet()) {
                const key   = String(entry.getKey());
                const value = String(entry.getValue());
                if ((tagsAlvo.has(key) || key.startsWith("name:")) && value) {
                    const novo = formatarNome(value);
                    if (novo !== value) {
                        alteracoes.push(value + " → " + novo);
                        println("Corrigido [{0}]: {1} -> {2}", key, value, novo);
                        commands.add(new ChangePropertyCommand(obj, key, novo));
                    }
                }
            }
        }
        if (!commands.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Correção Lote", commands));
            let resumo = alteracoes.join("\n");
            if (resumo.length > 300) resumo = resumo.substring(0, 300) + "\n...(veja log no console)";
            new Notification("Sucesso: " + commands.size() + " tag(s) corrigida(s).\n" + resumo)
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        } else {
            new Notification("Tudo OK: Nada a corrigir.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    });
    painelLote.add(btnCorrigirSelecao);

    // --- SEÇÃO INDIVIDUAL ---
    const painelIndividual = new JPanel();
    painelIndividual.setLayout(new BoxLayout(painelIndividual, BoxLayout.Y_AXIS));
    painelIndividual.setBorder(BorderFactory.createTitledBorder("Entrada por Voz"));

    const btnVoz = new JButton("🎤 Ativar Ditado (Win+H)");
    const campoTexto = new JTextField(25);
    campoTexto.setFont(campoTexto.getFont().deriveFont(16.0));
    campoTexto.setHorizontalAlignment(SwingConstants.CENTER);

    btnVoz.addActionListener(() => {
        campoTexto.requestFocusInWindow();
        try {
            const robot = new Robot();
            robot.keyPress(KeyEvent.VK_WINDOWS);
            robot.keyPress(KeyEvent.VK_H);
            robot.keyRelease(KeyEvent.VK_H);
            robot.keyRelease(KeyEvent.VK_WINDOWS);
        } catch (e) { println("Erro Voz: {0}", e); }
    });

    // Enter no campo de texto dispara a mesma ação do botão Aplicar
    const ActionListener = Java.extend(Java.type("java.awt.event.ActionListener"));
    const aplicarDitado = new ActionListener({ actionPerformed: function() {
        const layer = MainApplication.getLayerManager().getEditLayer();
        if (!layer) {
            new Notification("Erro: Sem camada ativa!")
                .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
            return;
        }
        const selection = layer.data.getSelected();
        if (selection.isEmpty()) {
            new Notification("Selecione um objeto no mapa.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }
        const valorOriginal = campoTexto.getText();
        if (!valorOriginal.trim()) return;
        const nomeFinal = formatarNome(valorOriginal);
        const commands = new ArrayList();
        const it = selection.iterator();
        while (it.hasNext()) {
            commands.add(new ChangePropertyCommand(it.next(), "name", nomeFinal));
        }
        UndoRedoHandler.getInstance().add(new SequenceCommand("Voz: " + nomeFinal, commands));
        println("Aplicado via Voz: {0}", nomeFinal);
        campoTexto.setText("");
        campoTexto.requestFocusInWindow();
    }});
    campoTexto.addActionListener(aplicarDitado); // Enter no campo

    const btnAplicar = new JButton("Aplicar Ditado", UIManager.getIcon("OptionPane.yesIcon"));
    btnAplicar.addActionListener(aplicarDitado); // botão reutiliza o mesmo listener

    const pMic = new JPanel(new FlowLayout(FlowLayout.CENTER));
    pMic.add(btnVoz);
    const pApp = new JPanel(new FlowLayout(FlowLayout.CENTER));
    pApp.add(btnAplicar);

    painelIndividual.add(pMic);
    painelIndividual.add(campoTexto);
    painelIndividual.add(pApp);

    mainPanel.add(painelLote);
    mainPanel.add(Box.createVerticalStrut(10));
    mainPanel.add(painelIndividual);

    voiceDialog.add(mainPanel);
    voiceDialog.pack();
    voiceDialog.setLocationRelativeTo(MainApplication.getMainFrame());

    // Fecha ao remover a camada
    const sourceDs = _layer.data;
    layerListener = new LayerChangeListener({
        layerAdded:        function(_e) {},
        layerOrderChanged: function(_e) {},
        layerRemoving:     function(e) {
            const removed = e.getRemovedLayer();
            if (removed && removed.data && removed.data === sourceDs) {
                SwingUtilities.invokeLater(function() {
                    cleanup();
                    new Notification("Camada removida. Diálogo fechado.")
                        .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
                });
            }
        }
    });
    MainApplication.getLayerManager().addLayerChangeListener(layerListener);

    // Remove window listener e limpa ao fechar o diálogo pelo X
    windowAdapter = new WindowAdapter({ windowClosing: function() {
        cleanup();
    }});
    voiceDialog.addWindowListener(windowAdapter);

    voiceDialog.setVisible(true);
}

const _layer = MainApplication.getLayerManager().getEditLayer();
if (!_layer || !_layer.data) {
    new Notification("Nenhuma camada de edição ativa.")
        .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
} else {
    mostrarInterfaceVoz();
}
