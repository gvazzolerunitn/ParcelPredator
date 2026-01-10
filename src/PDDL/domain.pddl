;; Domain for grid-based agent movement
;; Supports 4-directional movement avoiding obstacles and other agents

(define (domain deliveroo-movement)
  (:requirements :strips :typing)
  
  (:types
    tile - object
  )
  
  (:predicates
    (at ?t - tile)              ; agent is at tile t
    (adjacent-up ?from ?to - tile)    ; to is above from (y+1)
    (adjacent-down ?from ?to - tile)  ; to is below from (y-1)
    (adjacent-left ?from ?to - tile)  ; to is left of from (x-1)
    (adjacent-right ?from ?to - tile) ; to is right of from (x+1)
    (walkable ?t - tile)        ; tile is accessible (not wall)
    (free ?t - tile)            ; tile is not occupied by another agent
  )
  
  (:action move-up
    :parameters (?from ?to - tile)
    :precondition (and
      (at ?from)
      (adjacent-up ?from ?to)
      (walkable ?to)
      (free ?to)
    )
    :effect (and
      (at ?to)
      (not (at ?from))
    )
  )
  
  (:action move-down
    :parameters (?from ?to - tile)
    :precondition (and
      (at ?from)
      (adjacent-down ?from ?to)
      (walkable ?to)
      (free ?to)
    )
    :effect (and
      (at ?to)
      (not (at ?from))
    )
  )
  
  (:action move-left
    :parameters (?from ?to - tile)
    :precondition (and
      (at ?from)
      (adjacent-left ?from ?to)
      (walkable ?to)
      (free ?to)
    )
    :effect (and
      (at ?to)
      (not (at ?from))
    )
  )
  
  (:action move-right
    :parameters (?from ?to - tile)
    :precondition (and
      (at ?from)
      (adjacent-right ?from ?to)
      (walkable ?to)
      (free ?to)
    )
    :effect (and
      (at ?to)
      (not (at ?from))
    )
  )
)
