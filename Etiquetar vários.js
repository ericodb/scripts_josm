"use strict";

// --- IMPORTAÇÕES ---
const JDialog = Java.type("javax.swing.JDialog");
const JPanel = Java.type("javax.swing.JPanel");
const JLabel = Java.type("javax.swing.JLabel");
const JButton = Java.type("javax.swing.JButton");
const JTextField = Java.type("javax.swing.JTextField");
const JScrollPane = Java.type("javax.swing.JScrollPane");
const JTable = Java.type("javax.swing.JTable");
const DefaultTableModel = Java.type("javax.swing.table.DefaultTableModel");
const DefaultCellEditor = Java.type("javax.swing.DefaultCellEditor");
const BorderLayout = Java.type("java.awt.BorderLayout");
const Dimension = Java.type("java.awt.Dimension");
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification = Java.type("org.openstreetmap.josm.gui.Notification");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const ChangePropertyCommand = Java.type("org.openstreetmap.josm.command.ChangePropertyCommand");
const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const UIManager = Java.type("javax.swing.UIManager");
const ArrayList = Java.type("java.util.ArrayList");

(function() {
    const layer = MainApplication.getLayerManager().getEditLayer();
    const ds = layer ? layer.data : null;

    if (!ds) {
        new Notification("Nenhuma camada de edição ativa.")
            .setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        return;
    }

    // --- CLASSE DA TABELA (Customizada para bloquear coluna 0) ---
    const NonEditableModel = Java.extend(DefaultTableModel, {
        isCellEditable: function(row, column) {
            return column === 1; // Apenas a coluna "Novo Valor" é editável
        }
    });

    const model = new NonEditableModel(["Valor Original", "Novo Valor"], 0);
    const table = new JTable(model);
    table.getColumnModel().getColumn(1).setCellEditor(new DefaultCellEditor(new JTextField()));

    const dialog = new JDialog(MainApplication.getMainFrame(), "Editar valores de chave", true);
    dialog.setLayout(new BorderLayout());
    dialog.setPreferredSize(new Dimension(500, 400));

    // --- PAINEL SUPERIOR ---
    const topPanel = new JPanel();
    topPanel.add(new JLabel("Chave:"));
    const keyField = new JTextField(20);
    topPanel.add(keyField);
    
    const btnLoad = new JButton("Carregar");
    btnLoad.addActionListener(function(e) {
        const key = keyField.getText().trim();
        if (!key) {
            new Notification("Informe uma chave primeiro.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        model.setRowCount(0);
        const values = new Set();
        const primitives = ds.allPrimitives().iterator();
        
        while (primitives.hasNext()) {
            let p = primitives.next();
            if (p.hasKey(key)) {
                values.add(p.get(key));
            }
        }

        if (values.size === 0) {
            new Notification("Nenhum valor encontrado para a chave '" + key + "'.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            return;
        }

        // Converter Set para Array e ordenar
        Array.from(values).sort().forEach(v => {
            model.addRow([v, v]);
        });
    });
    topPanel.add(btnLoad);
    dialog.add(topPanel, BorderLayout.NORTH);

    // --- CENTRO (Tabela) ---
    dialog.add(new JScrollPane(table), BorderLayout.CENTER);

    // --- PAINEL INFERIOR (Botão Aplicar) ---
    const bottomPanel = new JPanel();
    const btnApply = new JButton("Aplicar alterações");
    btnApply.addActionListener(function(e) {
        // Para garantir que a edição da célula atual seja salva antes de aplicar
        if (table.isEditing()) {
            table.getCellEditor().stopCellEditing();
        }

        const key = keyField.getText().trim();
        const replacements = new Map();
        
        for (let r = 0; r < model.getRowCount(); r++) {
            let oldVal = model.getValueAt(r, 0);
            let newVal = model.getValueAt(r, 1);
            if (oldVal !== newVal) {
                replacements.set(oldVal, newVal);
            }
        }

        if (replacements.size === 0) {
            new Notification("Nenhuma alteração feita.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            return;
        }

        const commands = new ArrayList();
        const primitives = ds.allPrimitives().iterator();
        while (primitives.hasNext()) {
            let p = primitives.next();
            if (p.hasKey(key)) {
                let currentVal = p.get(key);
                if (replacements.has(currentVal)) {
                    commands.add(new ChangePropertyCommand(p, key, replacements.get(currentVal)));
                }
            }
        }

        if (!commands.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Editar valores da chave '" + key + "'", commands));
            new Notification(commands.size() + " valores alterados.")
                .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            dialog.dispose();
        }
    });
    
    bottomPanel.add(btnApply);
    dialog.add(bottomPanel, BorderLayout.SOUTH);

    dialog.pack();
    dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
})();