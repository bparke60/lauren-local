import Foundation
import CoreGraphics
let bounds = CGRect(x: -100, y: -50, width: 200, height: 100)
var motion = PresenceMotion(position: CGPoint(x: 99, y: 0), velocity: CGVector(dx: 80, dy: 0), cruise: CGVector(dx: 80, dy: 0))
precondition(motion.step(seconds: 0.05, in: bounds))
precondition(motion.position.x <= bounds.maxX && motion.velocity.dx < 0)
precondition(!motion.step(seconds: 0.05, in: bounds))
precondition(motion.position.x < bounds.maxX)
motion.position = CGPoint(x: 2000, y: -2000);motion.contain(in: bounds)
precondition(bounds.contains(motion.position) || motion.position.x == bounds.maxX)
motion.release(with: CGVector(dx: 10000, dy: -10000))
precondition(hypot(motion.velocity.dx, motion.velocity.dy) <= 420.001)
let old = motion.position
motion.step(seconds: 1000, in: bounds)
precondition(hypot(motion.position.x-old.x,motion.position.y-old.y) < 30)
print("Native motion checks passed: reflection, screen containment, toss limit, wake-time step.")
