// @Codex: WUL-673. Value-only generation fence used by the actual Repertori store.
import Foundation

struct RepertoriRequestFence<Identity: Equatable> {
    struct Ticket {
        fileprivate let generation: UUID
        fileprivate let identity: Identity
    }
    private var generation = UUID()

    mutating func invalidate() { generation = UUID() }
    mutating func begin(identity: Identity) -> Ticket {
        invalidate()
        return Ticket(generation: generation, identity: identity)
    }
    func isCurrent(_ ticket: Ticket, identity: Identity?) -> Bool {
        ticket.generation == generation && identity == ticket.identity
    }
}
