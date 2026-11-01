import Foundation
import CoreGraphics

struct PresenceMotion {
    var position: CGPoint
    var velocity: CGVector = CGVector(dx: -28, dy: 12)
    var cruise: CGVector = CGVector(dx: -28, dy: 12)

    mutating func contain(in bounds: CGRect) {
        position.x = min(max(position.x, bounds.minX), bounds.maxX)
        position.y = min(max(position.y, bounds.minY), bounds.maxY)
    }

    @discardableResult
    mutating func step(seconds: Double, in bounds: CGRect) -> Bool {
        let dt = min(max(seconds, 0), 0.05)
        let blend = 1 - exp(-dt * 0.6)
        velocity.dx += (cruise.dx - velocity.dx) * blend
        velocity.dy += (cruise.dy - velocity.dy) * blend
        position.x += velocity.dx * dt
        position.y += velocity.dy * dt
        var bounced = false
        if position.x < bounds.minX || position.x > bounds.maxX {
            velocity.dx = position.x < bounds.minX ? abs(velocity.dx) : -abs(velocity.dx)
            cruise.dx = position.x < bounds.minX ? abs(cruise.dx) : -abs(cruise.dx)
            bounced = true
        }
        if position.y < bounds.minY || position.y > bounds.maxY {
            velocity.dy = position.y < bounds.minY ? abs(velocity.dy) : -abs(velocity.dy)
            cruise.dy = position.y < bounds.minY ? abs(cruise.dy) : -abs(cruise.dy)
            bounced = true
        }
        contain(in: bounds)
        return bounced
    }

    mutating func release(with proposed: CGVector) {
        let speed = hypot(proposed.dx, proposed.dy)
        let scale = speed > 420 ? 420 / speed : 1
        velocity = CGVector(dx: proposed.dx * scale, dy: proposed.dy * scale)
    }
}
