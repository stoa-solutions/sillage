import RecallKit
import SwiftUI

/// The agent the DJ answers as, a small menu next to the source in the composer.
struct AgentMenu: View {
  @ObservedObject var agents: DJAgentsModel
  @Environment(\.openSettings) private var openSettings
  @AppStorage(SettingsPage.requestKey) private var requestedPage = ""
  var body: some View {
    // Hidden until the server lists agents: an older server has none to offer.
    Group { if !agents.agents.isEmpty { menu } }
      .task { if agents.agents.isEmpty { await agents.load() } }
  }
  private var menu: some View {
    Menu {
      Picker(
        "Agent",
        selection: Binding(get: { agents.selectedID }, set: { agents.select($0) })
      ) {
        ForEach(agents.baseAgents) { Text($0.name).tag($0.id) }
        if !agents.customAgents.isEmpty {
          Divider()
          ForEach(agents.customAgents) { Text($0.name).tag($0.id) }
        }
      }.pickerStyle(.inline)
      Divider()
      Button("Gérer les agents…") {
        requestedPage = SettingsPage.agents.rawValue
        NSApp.activate(ignoringOtherApps: true)
        openSettings()
      }
    } label: {
      HStack(spacing: 4) {
        Image(systemName: "person.wave.2").imageScale(.small)
        Text(agents.selectedName).lineLimit(1)
        Image(systemName: "chevron.down").imageScale(.small)
      }
      .font(.caption.weight(.medium)).foregroundStyle(.secondary)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .background(Capsule().fill(Color.sillageHover))
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Agent : \(agents.selectedName)")
    }
    .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
    .help("Choisis qui te répond. L’agent change le ton et les préférences, pas les règles du DJ.")
  }
}

/// Réglages → Agents: the base agents to pick or copy, and the account's own to write.
struct DJAgentsSettings: View {
  @ObservedObject var agents: DJAgentsModel
  @State private var focus: String?
  @State private var draft = Draft()
  @State private var saving = false
  @State private var confirmingDelete = false
  /// Where to go once the listener agrees to drop unsaved changes.
  @State private var pendingFocus: PendingFocus?

  private enum PendingFocus {
    case agent(DJAgent?)
    case new(name: String, instructions: String)
  }

  private struct Draft: Equatable {
    var id: String?
    var name = ""
    var instructions = ""
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(
        "Un agent change le ton et les préférences du DJ. Il garde toujours ses règles : sources, exclusions, nombre de titres et vérification des morceaux."
      )
      .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      HStack(alignment: .top, spacing: 16) {
        list.frame(width: 210)
        editor.frame(maxWidth: .infinity, alignment: .topLeading)
      }
      if !agents.error.isEmpty {
        Text(agents.error).font(.caption).foregroundStyle(.orange).textSelection(.enabled)
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .task {
      await agents.load()
      if focus == nil && draft.id == nil && !isDirty {
        show(agents.selected ?? agents.agents.first)
      }
    }
    .confirmationDialog(
      "Abandonner les modifications ?",
      isPresented: Binding(get: { pendingFocus != nil }, set: { if !$0 { pendingFocus = nil } })
    ) {
      Button("Abandonner", role: .destructive) {
        if let pending = pendingFocus { go(pending) }
        pendingFocus = nil
      }
    } message: {
      Text(
        "Les changements de « \(draft.name.isEmpty ? "Nouvel agent" : draft.name) » ne sont pas enregistrés."
      )
    }
  }

  // MARK: - List

  private var list: some View {
    VStack(alignment: .leading, spacing: 4) {
      section("De base")
      ForEach(agents.baseAgents) { row($0) }
      section("Les miens").padding(.top, 10)
      if agents.customAgents.isEmpty && draft.id != nil {
        Text("Aucun pour l’instant.").font(.caption).foregroundStyle(.secondary)
          .padding(.horizontal, 10)
      }
      ForEach(agents.customAgents) { row($0) }
      if focus == nil {
        rowLabel(name: draft.name.isEmpty ? "Nouvel agent" : draft.name, active: false)
          .background(Color.recall.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
      }
      Button {
        leave(to: .new(name: "", instructions: ""))
      } label: {
        Label("Nouvel agent", systemImage: "plus").font(.callout)
          .padding(.horizontal, 10).padding(.vertical, 6)
      }.buttonStyle(.plain).foregroundStyle(Color.recall).padding(.top, 6)
        .disabled(focus == nil)
      if agents.loading && agents.agents.isEmpty {
        ProgressView().controlSize(.small).padding(10)
      }
    }
  }

  private func section(_ title: String) -> some View {
    Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
      .padding(.horizontal, 10)
  }

  private func row(_ agent: DJAgent) -> some View {
    Button {
      leave(to: .agent(agent))
    } label: {
      rowLabel(name: agent.name, active: agent.id == agents.selectedID)
        .background(
          focus == agent.id ? Color.recall.opacity(0.16) : .clear,
          in: RoundedRectangle(cornerRadius: 8))
    }.buttonStyle(.plain)
      .accessibilityAddTraits(focus == agent.id ? .isSelected : [])
  }

  private func rowLabel(name: String, active: Bool) -> some View {
    HStack(spacing: 8) {
      Text(name).lineLimit(1)
      Spacer(minLength: 0)
      if active {
        Image(systemName: "checkmark").font(.caption.weight(.semibold))
          .foregroundStyle(Color.recall).accessibilityLabel("Utilisé")
      }
    }
    .padding(.horizontal, 10).padding(.vertical, 7)
    .contentShape(Rectangle())
  }

  // MARK: - Editor

  @ViewBuilder private var editor: some View {
    if let agent = focusedAgent, agent.base {
      baseDetail(agent)
    } else {
      customEditor
    }
  }

  private var focusedAgent: DJAgent? { agents.agents.first { $0.id == focus } }

  private func baseDetail(_ agent: DJAgent) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(agent.name).font(.title3.weight(.semibold))
      Text("Agent de base · lecture seule").font(.caption).foregroundStyle(.secondary)
      ScrollView {
        Text(
          agent.instructions.isEmpty
            ? "Le comportement habituel du DJ, sans profil ajouté." : agent.instructions
        )
        .font(.callout).textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
      }
      .frame(maxHeight: 320)
      .background(RoundedRectangle(cornerRadius: 10).fill(Color.sillageHover))
      HStack {
        useButton(agent.id)
        if !agent.instructions.isEmpty {
          Button("Dupliquer pour l’adapter") {
            leave(
              to: .new(
                name: String("\(agent.name) perso".prefix(DJAgent.nameLimit)),
                instructions: agent.instructions))
          }
        }
      }
    }
  }

  private var customEditor: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Nom").font(.caption.weight(.medium)).foregroundStyle(.secondary)
        TextField("Soirée calme", text: limited(\.name, DJAgent.nameLimit))
          .textFieldStyle(.roundedBorder)
      }
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text("Instructions").font(.caption.weight(.medium)).foregroundStyle(.secondary)
          Spacer()
          Text("\(draft.instructions.count) / \(DJAgent.instructionsLimit)")
            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        TextEditor(text: limited(\.instructions, DJAgent.instructionsLimit))
          .font(.callout).scrollContentBackground(.hidden).padding(8)
          .frame(minHeight: 220, maxHeight: 320)
          .background(RoundedRectangle(cornerRadius: 10).fill(Color.sillageHover))
          .overlay(alignment: .topLeading) {
            if draft.instructions.isEmpty {
              Text(
                "Ex. : Réponds en une phrase. Pour une suite, reste sur des morceaux doux et évite les lives."
              )
              .font(.callout).foregroundStyle(.tertiary).padding(13).allowsHitTesting(false)
            }
          }
        Text(
          "Décris des comportements concrets : longueur des réponses, ce que tu veux entendre ou éviter, les liens à expliquer."
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      HStack {
        Button(saving ? "Enregistrement…" : "Enregistrer") { Task { await save() } }
          .buttonStyle(.borderedProminent).disabled(!canSave)
          .keyboardShortcut("s", modifiers: .command)
        if let id = draft.id {
          useButton(id)
          Spacer()
          Button("Supprimer", role: .destructive) { confirmingDelete = true }
            .disabled(saving)
        } else {
          Button("Annuler") { leave(to: .agent(agents.selected ?? agents.agents.first)) }
        }
      }
    }
    .confirmationDialog(
      "Supprimer « \(draft.name) » ?", isPresented: $confirmingDelete
    ) {
      Button("Supprimer", role: .destructive) { Task { await remove() } }
    } message: {
      Text("Le DJ reprendra l’agent par défaut s’il était utilisé.")
    }
  }

  private func useButton(_ id: String) -> some View {
    Group {
      if agents.selectedID == id {
        Label("Utilisé par le DJ", systemImage: "checkmark").font(.callout)
          .foregroundStyle(.secondary)
      } else {
        Button("Utiliser cet agent") { agents.select(id) }.disabled(saving)
      }
    }
  }

  /// The draft differs from what the server has (or a new agent has content).
  private var isDirty: Bool {
    guard let saved = focusedAgent else {
      return !draft.name.isEmpty || !draft.instructions.isEmpty
    }
    return !saved.base && (saved.name != draft.name || saved.instructions != draft.instructions)
  }

  private var canSave: Bool {
    let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
    let instructions = draft.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !saving, !name.isEmpty, !instructions.isEmpty else { return false }
    guard let saved = focusedAgent else { return true }
    return saved.name != draft.name || saved.instructions != draft.instructions
  }

  /// Keeps the text within what the server accepts instead of failing on save.
  private func limited(_ path: WritableKeyPath<Draft, String>, _ limit: Int) -> Binding<String> {
    Binding(
      get: { draft[keyPath: path] },
      set: { draft[keyPath: path] = String($0.prefix(limit)) })
  }

  // MARK: - Actions

  /// Moves to another agent or a new draft, asking first when changes would be lost.
  private func leave(to target: PendingFocus) {
    if isDirty { pendingFocus = target } else { go(target) }
  }

  private func go(_ target: PendingFocus) {
    switch target {
    case .agent(let agent): show(agent)
    case .new(let name, let instructions): startNew(name: name, instructions: instructions)
    }
  }

  private func show(_ agent: DJAgent?) {
    focus = agent?.id
    draft = Draft(id: agent?.id, name: agent?.name ?? "", instructions: agent?.instructions ?? "")
  }

  private func startNew(name: String = "", instructions: String = "") {
    focus = nil
    draft = Draft(id: nil, name: name, instructions: instructions)
  }

  private func save() async {
    saving = true
    defer { saving = false }
    let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
    let instructions = draft.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
    let saved =
      if let id = draft.id {
        await agents.update(id, name: name, instructions: instructions)
      } else {
        await agents.create(name: name, instructions: instructions)
      }
    if let saved { show(saved) }
  }

  private func remove() async {
    guard let id = draft.id else { return }
    saving = true
    defer { saving = false }
    if await agents.delete(id) { show(agents.selected ?? agents.agents.first) }
  }
}
