"use strict";

// --- Importações de API ---
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const MapViewPaintable = Java.type("org.openstreetmap.josm.gui.layer.MapViewPaintable");
const OsmDataLayer    = Java.type("org.openstreetmap.josm.gui.layer.OsmDataLayer");
const SwingUtilities  = Java.type("javax.swing.SwingUtilities");
const JOptionPane     = Java.type("javax.swing.JOptionPane");
const JDialog         = Java.type("javax.swing.JDialog");
const JButton         = Java.type("javax.swing.JButton");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JTable              = Java.type("javax.swing.JTable");
const JScrollPane         = Java.type("javax.swing.JScrollPane");
const JSeparator          = Java.type("javax.swing.JSeparator");
const DefaultTableModel   = Java.type("javax.swing.table.DefaultTableModel");
const TableRowSorter      = Java.type("javax.swing.table.TableRowSorter");
const RowSorterSortKey    = Java.type("javax.swing.RowSorter$SortKey");
const SortOrder           = Java.type("javax.swing.SortOrder");
const DefaultTableCellRenderer = Java.type("javax.swing.table.DefaultTableCellRenderer");
const ListSelectionModel  = Java.type("javax.swing.ListSelectionModel");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const Box             = Java.type("javax.swing.Box");
const SwingConstants  = Java.type("javax.swing.SwingConstants");
const Color           = Java.type("java.awt.Color");
const BasicStroke     = Java.type("java.awt.BasicStroke");
const BorderLayout    = Java.type("java.awt.BorderLayout");
const AlphaComposite  = Java.type("java.awt.AlphaComposite");
const Component       = Java.type("java.awt.Component");
const Dimension       = Java.type("java.awt.Dimension");
const Font            = Java.type("java.awt.Font");
const Line2D          = Java.type("java.awt.geom.Line2D");
const AffineTransform = Java.type("java.awt.geom.AffineTransform");
const WindowAdapter   = Java.extend(Java.type("java.awt.event.WindowAdapter"));
const ActionListener  = Java.extend(Java.type("java.awt.event.ActionListener"));

const SequenceCommand = Java.type("org.openstreetmap.josm.command.SequenceCommand");
const ChangeRelationMemberRoleCommand = Java.type("org.openstreetmap.josm.command.ChangeRelationMemberRoleCommand");
const ChangeMembersCommand = Java.type("org.openstreetmap.josm.command.ChangeMembersCommand");
const UndoRedoHandler = Java.type("org.openstreetmap.josm.data.UndoRedoHandler");
const Way             = Java.type("org.openstreetmap.josm.data.osm.Way");
const Relation        = Java.type("org.openstreetmap.josm.data.osm.Relation");
const RelationMember  = Java.type("org.openstreetmap.josm.data.osm.RelationMember");

// --- Faxina prévia de instâncias anteriores ---
if (globalThis.__scriptCleanup__) {
    try { globalThis.__scriptCleanup__(); } catch(e) {}
}
if (globalThis.scriptCleanup) {
    try { globalThis.scriptCleanup(); } catch(e) {}
}
if (globalThis.busRouteTool) {
    try { globalThis.busRouteTool.removeArrows(true); } catch(e) {}
}

globalThis.busRouteTool = {
    currentArrows: null,
    activeRelation: null,
    dialog: null,
    toggleBtn: null,
    fixBtn: null,
    invertAllBtn: null,
    invertSelBtn: null,
    sourceDs: null,
    tableModel: null,
    relationTable: null,
    selecaoTravada: false, // true = seleção mantida mesmo ao clicar no mapa
    selecaoListener: null, // DataSelectionListener para restaurar seleção
    btnSelecionar: null,
    btnRecarregar: null,
    lblRelsEncontradas: null,
    selectionChangeListener: null,
    layerChangeListener: null,
    identifiedIds: new Set(),   // IDs das relações atualmente identificadas
    tableRowSorter: null,       // TableRowSorter configurável
    chkIdentTopo: null,         // checkbox "identificadas no topo"

    checkLayer: function() {
        if (!this.sourceDs) return false;
        const current = MainApplication.getLayerManager().getEditDataSet();
        if (current !== this.sourceDs) {
            this.removeArrows(true);
            return false;
        }
        return true;
    },

    createPaintable: function() {
        const self = this;
        const PaintClass = Java.extend(MapViewPaintable, {
            paint: function(g, mv, bbox) {
                if (!self.activeRelation || !self.activeRelation.isUsable()) return;
                try {
                    g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.75));
                    g.setStroke(new BasicStroke(4, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                    const members = self.activeRelation.getMembers();
                    for (let i = 0; i < members.size(); i++) {
                        const m = members.get(i);
                        if (m.isWay()) {
                            const way = m.getWay();
                            if (!way || !way.isUsable()) continue;
                            const nodes = way.getNodes();
                            const role = m.getRole();
                            const isBackward = (role === "backward");
                            g.setColor((role !== "forward" && role !== "backward") ? Color.YELLOW : new Color(0, 100, 255));
                            const nodeCount = nodes.size();
                            for (let j = 0; j < nodeCount - 1; j++) {
                                const n1 = isBackward ? nodes.get(nodeCount - 1 - j) : nodes.get(j);
                                const n2 = isBackward ? nodes.get(nodeCount - 2 - j) : nodes.get(j + 1);
                                const p1 = mv.getPoint(n1.getEastNorth());
                                const p2 = mv.getPoint(n2.getEastNorth());
                                g.draw(new Line2D.Float(p1.x, p1.y, p2.x, p2.y));
                                self.drawArrowHead(g, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, p1.x, p1.y, p2.x, p2.y);
                            }
                        }
                    }
                } catch(e) {}
            }
        });
        return new PaintClass();
    },

    drawArrowHead: function(g, x, y, x1, y1, x2, y2) {
        const arrowSize = 15;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const transform = new AffineTransform();
        transform.translate(x, y);
        transform.rotate(angle);
        const g2 = g.create();
        g2.transform(transform);
        g2.draw(new Line2D.Float(arrowSize, 0, 0, -arrowSize / 2));
        g2.draw(new Line2D.Float(arrowSize, 0, 0, arrowSize / 2));
        g2.dispose();
    },

    toggleArrows: function() {
        if (this.currentArrows) {
            this.removeArrows(false);
            return;
        }
        const ds = MainApplication.getLayerManager().getEditDataSet();
        if (!ds) {
            new Notification("Nenhum dataset ativo.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        const sel = ds.getSelectedRelations().toArray();
        if (sel.length === 0) {
            new Notification("Nenhuma relação selecionada.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        this.activeRelation = sel[0];
        this.sourceDs = ds;
        const mv = MainApplication.getMap().mapView;
        this.currentArrows = this.createPaintable();
        mv.addTemporaryLayer(this.currentArrows);
        mv.repaint();
        this.updateButtons(true);
        const relName = this.activeRelation.get("name") || "sem nome";
        new Notification("Setas ativadas para relação: <b>" + relName + "</b>")
            .setIcon(JOptionPane.INFORMATION_MESSAGE).show();
    },

    removeArrows: function(silent) {
        if (this.currentArrows) {
            try {
                const map = MainApplication.getMap();
                if (map) {
                    map.mapView.removeTemporaryLayer(this.currentArrows);
                    map.mapView.repaint();
                }
            } catch(e) {}
            this.currentArrows = null;
            this.activeRelation = null;
            this.sourceDs = null;
            this.updateButtons(false);
            if (!silent) new Notification("Setas desativadas.").setIcon(JOptionPane.INFORMATION_MESSAGE).show();
        }
    },

    updateButtons: function(active) {
        if (this.toggleBtn) this.toggleBtn.setText(active ? "Desligar" : "Ligar");
        [this.fixBtn, this.invertAllBtn, this.invertSelBtn].forEach(b => b && b.setEnabled(active));
    },

    fixRoles: function() {
        if (!this.checkLayer()) return;
        const cmds = new java.util.ArrayList();
        const members = this.activeRelation.getMembers();
        for (let i = 0; i < members.size(); i++) {
            if (!members.get(i).getRole()) {
                cmds.add(new ChangeRelationMemberRoleCommand(this.activeRelation, i, "forward"));
            }
        }
        if (!cmds.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Corrigir roles da rota", cmds));
            MainApplication.getMap().mapView.repaint();
            new Notification("Roles corrigidos com sucesso!").setIcon(JOptionPane.INFORMATION_MESSAGE).show();
        } else {
            new Notification("Nenhum role precisou ser corrigido.").setIcon(JOptionPane.INFORMATION_MESSAGE).show();
        }
    },

    invertAllRoles: function() {
        if (!this.checkLayer()) return;
        const cmds = new java.util.ArrayList();
        const members = this.activeRelation.getMembers();
        let hasInvertible = false;
        for (let i = 0; i < members.size(); i++) {
            const role = members.get(i).getRole();
            if (role === "forward") {
                cmds.add(new ChangeRelationMemberRoleCommand(this.activeRelation, i, "backward"));
                hasInvertible = true;
            } else if (role === "backward") {
                cmds.add(new ChangeRelationMemberRoleCommand(this.activeRelation, i, "forward"));
                hasInvertible = true;
            }
        }
        if (hasInvertible) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Inverter todos os roles da rota", cmds));
            MainApplication.getMap().mapView.repaint();
            new Notification("Roles invertidos com sucesso!").setIcon(JOptionPane.INFORMATION_MESSAGE).show();
        } else {
            new Notification("Nenhum role de 'forward' ou 'backward' encontrado.").setIcon(JOptionPane.WARNING_MESSAGE).show();
        }
    },

    invertSelectedWayRole: function() {
        if (!this.checkLayer()) return;
        const ds = MainApplication.getLayerManager().getEditDataSet();
        const selWays = ds.getSelectedWays().toArray();
        if (selWays.length === 0) {
            new Notification("Nenhuma via selecionada.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        if (selWays.length > 1) {
            new Notification("Selecione apenas uma via.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        const selectedWay = selWays[0];
        const members = this.activeRelation.getMembers();
        let found = false;
        for (let i = 0; i < members.size(); i++) {
            const m = members.get(i);
            if (m.getMember() == selectedWay) {
                const role = m.getRole();
                let newRole = (role === "forward") ? "backward" : (role === "backward" ? "forward" : null);
                if (!newRole) {
                    new Notification("A via não tem role 'forward' ou 'backward'.").setIcon(JOptionPane.WARNING_MESSAGE).show();
                    return;
                }
                UndoRedoHandler.getInstance().add(new ChangeRelationMemberRoleCommand(this.activeRelation, i, newRole));
                MainApplication.getMap().mapView.repaint();
                new Notification("Role invertido para '" + newRole + "'.").setIcon(JOptionPane.INFORMATION_MESSAGE).show();
                found = true;
                break;
            }
        }
        if (!found) {
            new Notification("A via não é membro da relação ativa.").setIcon(JOptionPane.WARNING_MESSAGE).show();
        }
    },

    // --- Gerenciar membros em múltiplas relações ---

    // Recarrega a lista de relações do dataset
    identificarRelacoes: function() {
        const ds = MainApplication.getLayerManager().getEditDataSet();
        if (!ds) return new Set();
        const ways = ds.getSelectedWays().toArray();
        const relsEncontradas = new Set();
        ways.forEach(way => {
            // getReferrers(true) inclui incompletas, igual ao JOSM PropertiesDialog
            const referrers = way.getReferrers(true).toArray();
            referrers.forEach(ref => {
                if (ref instanceof Relation && !ref.isIncomplete() && !ref.isDeleted())
                    relsEncontradas.add(ref);
            });
        });
        return relsEncontradas;
    },

    // Atualiza a coluna isIdent na tabela, re-ordena e seleciona as identificadas
    atualizarOrdenacao: function() {
        if (!this.tableModel || !this.tableRowSorter) return;
        const ativo = this.chkIdentTopo && this.chkIdentTopo.isSelected();

        // 1. Atualiza isIdent (col 4) para cada linha do modelo
        for (let r = 0; r < this.tableModel.getRowCount(); r++) {
            const id = String(this.tableModel.getValueAt(r, 2));
            this.tableModel.setValueAt(this.identifiedIds.has(id) ? "1" : "0", r, 4);
        }

        // 2. Aplica ou remove sort keys
        if (ativo) {
            const sortKeys = new java.util.ArrayList();
            sortKeys.add(new RowSorterSortKey(4, SortOrder.DESCENDING));
            this.tableRowSorter.setSortKeys(sortKeys);
            this.tableRowSorter.sort(); // força re-sort mesmo sem mudança de chave
        } else {
            this.tableRowSorter.setSortKeys(null);
        }

        // 3. Seleciona as linhas identificadas na view quando checkbox ativo
        if (ativo && this.identifiedIds.size > 0) {
            this.relationTable.clearSelection();
            for (let v = 0; v < this.relationTable.getRowCount(); v++) {
                const modelRow = this.relationTable.convertRowIndexToModel(v);
                const id = String(this.tableModel.getValueAt(modelRow, 2));
                if (this.identifiedIds.has(id)) {
                    this.relationTable.addRowSelectionInterval(v, v);
                }
            }
        }
    },

    // Atualiza o label de status com as relações identificadas
    atualizarStatusRelacoes: function() {
        if (!this.lblRelsEncontradas) return;
        const ds = MainApplication.getLayerManager().getEditDataSet();
        const waysStatus = ds ? ds.getSelectedWays().toArray() : [];
        if (waysStatus.length === 0) {
            this.lblRelsEncontradas.setText("<html><i>Selecione vias no mapa</i></html>");
            return;
        }
        const rels = this.identificarRelacoes();
        const filtradas = Array.from(rels).filter(r => {
            const t = r.get("type") || "";
            return t === "route" || t === "route_master" || t === "superroute";
        });
        // Atualiza o Set de IDs identificadas
        this.identifiedIds = new Set(filtradas.map(r => String(r.getUniqueId())));
        this.lblRelsEncontradas.setText(
            "<html>" + waysStatus.length + " via(s) → <b>" + filtradas.length +
            "</b> relação(ões) identificada(s)</html>");
        this.atualizarOrdenacao();
    },

    recarregarRelacoes: function() {
        if (!this.tableModel) return;
        const relsEncontradas = this.identificarRelacoes();
        if (relsEncontradas.size === 0) {
            new Notification("Selecione vias no mapa para identificar suas relações.")
                .setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        // IDs já presentes na tabela — evita duplicatas
        const idsPresentes = new Set();
        for (let r = 0; r < this.tableModel.getRowCount(); r++)
            idsPresentes.add(String(this.tableModel.getValueAt(r, 2)));
        let adicionadas = 0;
        relsEncontradas.forEach(rel => {
            const tipo = rel.get("type") || "?";
            if (tipo !== "route" && tipo !== "route_master" && tipo !== "superroute") return;
            const id = String(rel.getUniqueId());
            if (idsPresentes.has(id)) return;
            const ref  = rel.get("ref")  || "";
            const name = rel.get("name") || "sem nome";
            this.tableModel.addRow(Java.to(["", tipo, id, (ref ? ref + " - " : "") + name, "0", rel], "java.lang.Object[]"));
            adicionadas++;
        });
        if (adicionadas === 0)
            new Notification("Relações já estão na lista.")
                .setIcon(JOptionPane.INFORMATION_MESSAGE).show();
        else
            new Notification(adicionadas + " relação(ões) adicionada(s).")
                .setIcon(JOptionPane.INFORMATION_MESSAGE).show();
    },

    // Retorna relações selecionadas na JTable
    relacoesSelecionadas: function() {
        const indices = this.relationTable.getSelectedRows();
        const result = [];
        for (let i = 0; i < indices.length; i++) {
            const modelRow = this.relationTable.convertRowIndexToModel(indices[i]);
            result.push(this.tableModel.getValueAt(modelRow, 5)); // col 5 = objeto rel
        }
        return result;
    },

    adicionarMembros: function() {
        const ds = MainApplication.getLayerManager().getEditDataSet();
        if (!ds) {
            new Notification("Nenhum dataset ativo.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        const rels = this.relacoesSelecionadas();
        if (rels.length === 0) {
            new Notification("Selecione pelo menos uma relação na lista.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        const ways = ds.getSelectedWays().toArray();
        if (ways.length === 0) {
            new Notification("Selecione pelo menos uma via no mapa.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }

        const cmds = new java.util.ArrayList();
        let totalAdicionados = 0, totalIgnorados = 0;

        rels.forEach(rel => {
            const membersAtual = rel.getMembers(); // java.util.List<RelationMember>
            const novosMembers = new java.util.ArrayList(membersAtual);

            // IDs já presentes
            const idsPresentes = new Set();
            for (let i = 0; i < membersAtual.size(); i++) {
                idsPresentes.add(membersAtual.get(i).getMember().getUniqueId());
            }

            let adicionadosNesta = 0;
            ways.forEach(way => {
                if (idsPresentes.has(way.getUniqueId())) {
                    totalIgnorados++;
                } else {
                    novosMembers.add(new RelationMember("", way));
                    adicionadosNesta++;
                    totalAdicionados++;
                }
            });

            if (adicionadosNesta > 0) {
                cmds.add(new ChangeMembersCommand(rel, novosMembers));
            }
        });

        if (!cmds.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Adicionar membros a relações", cmds));
        }

        const viasUnicas = ways.length;
        let msg = viasUnicas + " via(s) adicionada(s) em " + rels.length + " relação(ões).";
        if (totalIgnorados > 0) msg += " " + totalIgnorados + " já existia(m) e foi(ram) ignorada(s).";
        new Notification(msg).setIcon(JOptionPane.INFORMATION_MESSAGE).show();
    },

    removerMembros: function() {
        const ds = MainApplication.getLayerManager().getEditDataSet();
        if (!ds) {
            new Notification("Nenhum dataset ativo.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        const rels = this.relacoesSelecionadas();
        if (rels.length === 0) {
            new Notification("Selecione pelo menos uma relação na lista.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }
        const ways = ds.getSelectedWays().toArray();
        if (ways.length === 0) {
            new Notification("Selecione pelo menos uma via no mapa.").setIcon(JOptionPane.WARNING_MESSAGE).show();
            return;
        }

        const idsRemover = new Set(ways.map(w => w.getUniqueId()));
        const cmds = new java.util.ArrayList();
        let totalRemovidos = 0;

        rels.forEach(rel => {
            const membersAtual = rel.getMembers();
            const novosMembers = new java.util.ArrayList();
            let removidosNesta = 0;

            for (let i = 0; i < membersAtual.size(); i++) {
                const m = membersAtual.get(i);
                if (idsRemover.has(m.getMember().getUniqueId())) {
                    removidosNesta++;
                    totalRemovidos++;
                } else {
                    novosMembers.add(m);
                }
            }

            if (removidosNesta > 0) {
                cmds.add(new ChangeMembersCommand(rel, novosMembers));
            }
        });

        if (!cmds.isEmpty()) {
            UndoRedoHandler.getInstance().add(new SequenceCommand("Remover membros de relações", cmds));
            new Notification(totalRemovidos + " via(s) removida(s) em " + rels.length + " relação(ões).").setIcon(JOptionPane.INFORMATION_MESSAGE).show();
        } else {
            new Notification("Nenhuma das vias selecionadas é membro das relações escolhidas.").setIcon(JOptionPane.WARNING_MESSAGE).show();
        }
    },

    showWindow: function() {
        if (this.dialog && this.dialog.isVisible()) {
            if (globalThis.scriptCleanup) {
                try { globalThis.scriptCleanup(); } catch(e) {}
            }
        }

        const safeRemoveFromAllDataSets = function(listener) {
            if (!listener) return;
            try {
                const layers = MainApplication.getLayerManager().getLayers().toArray();
                for (let i = 0; i < layers.length; i++) {
                    const l = layers[i];
                    if (l instanceof OsmDataLayer) {
                        const ds = l.getDataSet ? l.getDataSet() : null;
                        if (ds) {
                            try { ds.removeSelectionListener(listener); } catch(ex) {}
                        }
                    }
                }
            } catch(ex) {}
            try {
                const editDs = MainApplication.getLayerManager().getEditDataSet();
                if (editDs) {
                    try { editDs.removeSelectionListener(listener); } catch(ex) {}
                }
            } catch(ex) {}
        };

        const GridLayout   = Java.type("java.awt.GridLayout");
        const FlowLayout   = Java.type("java.awt.FlowLayout");
        const RelationEditor = Java.type("org.openstreetmap.josm.gui.dialogs.relation.RelationEditor");

        this.dialog = new JDialog(MainApplication.getMainFrame(), "Direção da Rota", false);
        // BorderLayout no diálogo: NORTH=botões direção, CENTER=seção membros
        this.dialog.setLayout(new BorderLayout(0, 0));

        const mkBtn = (txt, fn) => {
            const b = new JButton(txt);
            b.addActionListener(new ActionListener({ actionPerformed: fn }));
            return b;
        };

        // ── NORTH: botões de direção centralizados em FlowLayout ──
        const topPanel = new JPanel(new FlowLayout(FlowLayout.CENTER, 4, 6));
        topPanel.setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createMatteBorder(0, 0, 1, 0, new Color(180, 180, 180)),
            BorderFactory.createEmptyBorder(4, 6, 4, 6)
        ));

        this.toggleBtn    = mkBtn("Ligar",                  () => this.toggleArrows());
        this.fixBtn       = mkBtn("Corrigir Roles",          () => this.fixRoles());
        this.invertAllBtn = mkBtn("Inverter Todos",          () => this.invertAllRoles());
        this.invertSelBtn = mkBtn("Inverter Seleção",        () => this.invertSelectedWayRole());
        this.updateButtons(false);

        topPanel.add(this.toggleBtn);
        topPanel.add(this.fixBtn);
        topPanel.add(this.invertAllBtn);
        topPanel.add(this.invertSelBtn);
        this.dialog.add(topPanel, BorderLayout.NORTH);

        // ── CENTER: seção de membros com BorderLayout ──
        const centerPanel = new JPanel(new BorderLayout(0, 0));
        centerPanel.setBorder(BorderFactory.createEmptyBorder(6, 8, 8, 8));

        // Título
        const lblMembros = new JLabel("Gerenciar membros em múltiplas relações:");
        lblMembros.setFont(lblMembros.getFont().deriveFont(Font.BOLD, 11.0));
        lblMembros.setBorder(BorderFactory.createEmptyBorder(0, 0, 4, 0));
        centerPanel.add(lblMembros, BorderLayout.NORTH);

        const self = this;
        // Tabela de relações — ocupa todo o espaço disponível
        // Coluna 3 oculta armazena o objeto relação
        const NonEditableModel = Java.extend(DefaultTableModel, {
            isCellEditable: function(row, col) { return false; }
        });
        this.tableModel = new NonEditableModel(
            Java.to(["#", "Tipo", "ID", "Ref / Nome", "isIdent", "rel"], "java.lang.Object[]"), 0);
        this.relationTable = new JTable(this.tableModel);
        this.relationTable.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION);
        this.relationTable.setFont(this.relationTable.getFont().deriveFont(Font.PLAIN, 11.0));
        this.relationTable.setRowHeight(20);

        // TableRowSorter manual para controlar ordenação "identificadas no topo"
        this.tableRowSorter = new TableRowSorter(this.tableModel);
        this.relationTable.setRowSorter(this.tableRowSorter);

        // Renderer da coluna # — mostra sempre o índice de visualização
        // Renderer da coluna # — JLabel externo configurado a cada renderização
        const numLabel = new JLabel();
        numLabel.setOpaque(true);
        numLabel.setHorizontalAlignment(SwingConstants.RIGHT);
        numLabel.setFont(this.relationTable.getFont());
        const numRenderer = new (Java.extend(Java.type("javax.swing.table.TableCellRenderer"), {
            getTableCellRendererComponent: function(table, value, sel, focus, row, col) {
                numLabel.setText(String(row + 1));
                if (sel) {
                    numLabel.setBackground(table.getSelectionBackground());
                    numLabel.setForeground(table.getSelectionForeground());
                } else {
                    numLabel.setBackground(table.getBackground());
                    numLabel.setForeground(table.getForeground());
                }
                return numLabel;
            }
        }))();
        this.relationTable.getColumnModel().getColumn(0).setCellRenderer(numRenderer);

        // Ocultar colunas isIdent(4) e rel(5)
        [4, 5].forEach(c => {
            this.relationTable.getColumnModel().getColumn(c).setMinWidth(0);
            this.relationTable.getColumnModel().getColumn(c).setMaxWidth(0);
            this.relationTable.getColumnModel().getColumn(c).setWidth(0);
        });
        // Larguras das colunas visíveis
        this.relationTable.getColumnModel().getColumn(0).setPreferredWidth(28);
        this.relationTable.getColumnModel().getColumn(1).setPreferredWidth(65);
        this.relationTable.getColumnModel().getColumn(2).setPreferredWidth(55);
        this.relationTable.getColumnModel().getColumn(3).setPreferredWidth(210);

        // Painel de status: label + checkbox "identificadas no topo"
        const statusPanel = new JPanel(new BorderLayout(6, 0));
        this.lblRelsEncontradas = new JLabel("<html><i>Selecione vias no mapa</i></html>");
        this.lblRelsEncontradas.setFont(this.lblRelsEncontradas.getFont().deriveFont(Font.PLAIN, 10.5));
        this.chkIdentTopo = new (Java.type("javax.swing.JCheckBox"))("⬆ identificadas no topo", false);
        this.chkIdentTopo.setFont(this.chkIdentTopo.getFont().deriveFont(Font.PLAIN, 10.5));
        this.chkIdentTopo.setToolTipText("Ordena a tabela colocando as relações identificadas na seleção atual no topo");
        const chkRef = this.chkIdentTopo;
        chkRef.addActionListener(new (Java.extend(Java.type("java.awt.event.ActionListener")))({ actionPerformed: function() {
            busRouteTool.atualizarOrdenacao();
        }}));
        statusPanel.add(this.lblRelsEncontradas, BorderLayout.CENTER);
        statusPanel.add(this.chkIdentTopo, BorderLayout.EAST);
        statusPanel.setBorder(BorderFactory.createEmptyBorder(0, 0, 4, 0));
        centerPanel.add(statusPanel, BorderLayout.NORTH);

        const scrollRel = new JScrollPane(this.relationTable);
        scrollRel.setPreferredSize(new Dimension(380, 240));
        centerPanel.add(scrollRel, BorderLayout.CENTER);

        // ── SOUTH da seção central: barra de botões estilo JOSM ──
        const southPanel = new JPanel(new BorderLayout(0, 4));
        southPanel.setBorder(BorderFactory.createEmptyBorder(6, 0, 0, 0));

        // Linha 1: botões de ação na lista (recarregar, editar relação, selecionar relação)
        const btnBarTop = new JPanel(new GridLayout(1, 3, 4, 0));
        this.btnRecarregar = mkBtn("＋ Adicionar", () => {
            if (this.relationTable.getSelectedRows().length > 0) {
                // Remove as linhas selecionadas da tabela (de trás pra frente)
                const rows = this.relationTable.getSelectedRows();
                for (let i = rows.length - 1; i >= 0; i--) {
                    const modelRow = this.relationTable.convertRowIndexToModel(rows[i]);
                    this.tableModel.removeRow(modelRow);
                }
            } else {
                this.recarregarRelacoes();
            }
        });
        this.btnRecarregar.setToolTipText("Adicionar relações das vias selecionadas / Remover selecionadas da lista");
        const btnRecarregar = this.btnRecarregar;

        // Muda texto do botão conforme seleção na tabela
        const ListSelectionListener = Java.extend(
            Java.type("javax.swing.event.ListSelectionListener"), {
            valueChanged: function(e) {
                if (e.getValueIsAdjusting()) return;
                const temSel = self.relationTable.getSelectedRows().length > 0;
                self.btnRecarregar.setText(temSel ? "✖️ Remover" : "➕ Adicionar");
            }
        });
        this.relationTable.getSelectionModel().addListSelectionListener(new ListSelectionListener());

        const btnEditar = mkBtn("✏️ Editar", () => {
            const rels = this.relacoesSelecionadas();
            if (rels.length === 0) {
                new Notification("Selecione uma relação na lista.")
                    .setIcon(JOptionPane.WARNING_MESSAGE).show();
                return;
            }
            const layer = MainApplication.getLayerManager().getEditLayer();
            if (!layer) return;
            // Abre o editor para a primeira relação selecionada
            rels.forEach(rel => {
                try {
                    RelationEditor.getEditor(layer, rel, null).setVisible(true);
                } catch(e) {
                    new Notification("Erro ao abrir editor: " + e)
                        .setIcon(JOptionPane.ERROR_MESSAGE).show();
                }
            });
        });
        btnEditar.setToolTipText("Abrir editor da(s) relação(ões) selecionada(s)");

        this.btnSelecionar = mkBtn("✔️ Selecionar", () => {
            if (this.selecaoTravada) {
                // Destravar seleção
                this.selecaoTravada = false;
                this.btnSelecionar.setText("✔️ Selecionar");
                if (this.selecaoListener) {
                    safeRemoveFromAllDataSets(this.selecaoListener);
                    this.selecaoListener = null;
                }
                return;
            }
            const rels = this.relacoesSelecionadas();
            if (rels.length === 0) {
                new Notification("Selecione uma relação na lista.")
                    .setIcon(JOptionPane.WARNING_MESSAGE).show();
                return;
            }
            const ds = MainApplication.getLayerManager().getEditDataSet();
            if (!ds) return;
            // Aplica seleção imediata
            const col = new java.util.ArrayList();
            rels.forEach(r => col.add(r));
            ds.setSelected(col);
            // Trava: restaura seleção sempre que o JOSM a alterar
            this.selecaoTravada = true;
            this.btnSelecionar.setText("✖️ Deselecionar");
            const self = this;
            const DataSelectionListener = Java.extend(
                Java.type("org.openstreetmap.josm.data.osm.DataSelectionListener"), {
                selectionChanged: function(e) {
                    if (!self.selecaoTravada) return;
                    const dsNow = MainApplication.getLayerManager().getEditDataSet();
                    if (!dsNow) return;
                    // Verifica se alguma das relações travadas saiu da seleção
                    const selAtual = dsNow.getSelected();
                    let algumaSaiu = false;
                    rels.forEach(r => { if (!selAtual.contains(r)) algumaSaiu = true; });
                    if (!algumaSaiu) return; // relações ainda estão — nada a fazer
                    // Adiciona as relações à seleção atual sem remover vias/nós selecionados
                    const colNow = new java.util.ArrayList(selAtual);
                    rels.forEach(r => { if (!selAtual.contains(r)) colNow.add(r); });
                    dsNow.setSelected(colNow);
                }
            });
            this.selecaoListener = new DataSelectionListener();
            ds.addSelectionListener(this.selecaoListener);
        });
        const btnSelecionar = this.btnSelecionar;
        btnSelecionar.setToolTipText("Selecionar/travar relação(ões) no mapa");

        btnBarTop.add(btnRecarregar);
        btnBarTop.add(btnEditar);
        btnBarTop.add(this.btnSelecionar);
        southPanel.add(btnBarTop, BorderLayout.NORTH);

        // Linha 2: instrução
        const lblDica = new JLabel("<html><i>Selecione relações acima + vias no mapa</i></html>");
        lblDica.setFont(lblDica.getFont().deriveFont(Font.PLAIN, 10.0));
        southPanel.add(lblDica, BorderLayout.CENTER);

        // Linha 3: adicionar / remover
        const btnBarBot = new JPanel(new GridLayout(1, 2, 4, 0));
        const btnAdicionar = mkBtn("➕ Adicionar vias", () => this.adicionarMembros());
        btnAdicionar.setFont(btnAdicionar.getFont().deriveFont(Font.PLAIN, 12.0));
        const btnRemover   = mkBtn("➖ Remover vias",   () => this.removerMembros());
        btnRemover.setFont(btnRemover.getFont().deriveFont(Font.PLAIN, 12.0));
        btnBarBot.add(btnAdicionar);
        btnBarBot.add(btnRemover);
        southPanel.add(btnBarBot, BorderLayout.SOUTH);

        centerPanel.add(southPanel, BorderLayout.SOUTH);
        this.dialog.add(centerPanel, BorderLayout.CENTER);

        this.dialog.pack();
        this.dialog.setSize(450, 560);
        this.dialog.setLocationRelativeTo(MainApplication.getMainFrame());

        let isCleanedUp = false;
        const dialogRef = this.dialog;
        let windowAdapter = null;

        const cleanup = function() {
            if (isCleanedUp) return;
            isCleanedUp = true;

            busRouteTool.removeArrows(true);

            safeRemoveFromAllDataSets(busRouteTool.selecaoListener);
            busRouteTool.selecaoListener = null;

            safeRemoveFromAllDataSets(busRouteTool.selectionChangeListener);
            busRouteTool.selectionChangeListener = null;

            if (busRouteTool.layerChangeListener) {
                try {
                    MainApplication.getLayerManager().removeLayerChangeListener(busRouteTool.layerChangeListener);
                } catch(e) {}
                busRouteTool.layerChangeListener = null;
            }

            busRouteTool.selecaoTravada = false;

            if (dialogRef) {
                if (windowAdapter) {
                    try { dialogRef.removeWindowListener(windowAdapter); } catch(e) {}
                    windowAdapter = null;
                }
                try {
                    const listeners = dialogRef.getWindowListeners();
                    for (let i = 0; i < listeners.length; i++) {
                        dialogRef.removeWindowListener(listeners[i]);
                    }
                } catch(e) {}
                try { dialogRef.dispose(); } catch(e) {}
            }
            busRouteTool.dialog = null;
        };

        if (typeof __josmContextResetHooks__ !== 'undefined') {
            __josmContextResetHooks__.register(cleanup);
        }
        if (typeof josmContextResetHooks !== 'undefined') {
            josmContextResetHooks.register(cleanup);
        }

        globalThis.__scriptCleanup__ = cleanup;
        globalThis.scriptCleanup = cleanup;

        windowAdapter = new WindowAdapter({
            windowClosing: function(e) {
                SwingUtilities.invokeLater(function() {
                    cleanup();
                });
            },
            windowClosed: function(e) {}
        });
        this.dialog.addWindowListener(windowAdapter);

        // DataSelectionListener: atualiza o label de status quando a seleção muda
        const DataSelectionListenerStatus = Java.extend(
            Java.type("org.openstreetmap.josm.data.osm.DataSelectionListener"), {
            selectionChanged: function(e) {
                SwingUtilities.invokeLater(function() {
                    busRouteTool.atualizarStatusRelacoes();
                });
            }
        });
        this.selectionChangeListener = new DataSelectionListenerStatus();
        const dsInit = MainApplication.getLayerManager().getEditDataSet();
        if (dsInit) dsInit.addSelectionListener(this.selectionChangeListener);

        // LayerChangeListener: limpa tabela e listeners ao excluir a camada de dados
        if (this.layerChangeListener) {
            try { MainApplication.getLayerManager().removeLayerChangeListener(this.layerChangeListener); } catch(e) {}
            this.layerChangeListener = null;
        }

        const LayerChangeListenerClass = Java.extend(
            Java.type("org.openstreetmap.josm.gui.layer.LayerManager.LayerChangeListener"), {
            layerAdded: function(e) {
                if (!(e.getAddedLayer() instanceof OsmDataLayer)) return;
                SwingUtilities.invokeLater(function() {
                    const dsNovo = MainApplication.getLayerManager().getEditDataSet();
                    if (dsNovo && busRouteTool.selectionChangeListener) {
                        // Garante que não registra duas vezes
                        try { dsNovo.removeSelectionListener(busRouteTool.selectionChangeListener); } catch(ex) {}
                        dsNovo.addSelectionListener(busRouteTool.selectionChangeListener);
                    }
                    busRouteTool.atualizarStatusRelacoes();
                });
            },
            layerOrderChanged: function(e) {},
            layerRemoving: function(e) {
                const removed = e.getRemovedLayer();
                if (!(removed instanceof OsmDataLayer)) return;
                const dsRemoved = removed.getDataSet ? removed.getDataSet() : null;
                if (busRouteTool.sourceDs && dsRemoved === busRouteTool.sourceDs) {
                    busRouteTool.removeArrows(true);
                }
                SwingUtilities.invokeLater(function() {
                    // Remove listeners do dataset que está sendo excluído e de todas as camadas
                    if (dsRemoved) {
                        try { dsRemoved.removeSelectionListener(busRouteTool.selecaoListener); } catch(ex) {}
                        try { dsRemoved.removeSelectionListener(busRouteTool.selectionChangeListener); } catch(ex) {}
                    }

                    // Limpa tabela, estado e listeners
                    if (busRouteTool.tableModel) busRouteTool.tableModel.setRowCount(0);
                    busRouteTool.identifiedIds = new Set();
                    busRouteTool.selecaoTravada = false;
                    if (busRouteTool.btnSelecionar)
                        busRouteTool.btnSelecionar.setText("⊙ Selecionar");
                    if (busRouteTool.lblRelsEncontradas)
                        busRouteTool.lblRelsEncontradas.setText(
                            "<html><i>Selecione vias no mapa</i></html>");

                    // Re-registra listener no novo dataset ativo (se houver)
                    const dsNovo = MainApplication.getLayerManager().getEditDataSet();
                    if (dsNovo && busRouteTool.selectionChangeListener) {
                        safeRemoveFromAllDataSets(busRouteTool.selectionChangeListener);
                        dsNovo.addSelectionListener(busRouteTool.selectionChangeListener);
                    }
                });
            }
        });
        this.layerChangeListener = new LayerChangeListenerClass();
        MainApplication.getLayerManager().addLayerChangeListener(this.layerChangeListener);

        this.atualizarStatusRelacoes();
        this.dialog.setVisible(true);
    }
};

// --- Início ---
if (!MainApplication.isDisplayingMapView()) {
    new Notification("Nenhuma camada ativa.").setIcon(JOptionPane.ERROR_MESSAGE).show();
} else {
    busRouteTool.showWindow();
}