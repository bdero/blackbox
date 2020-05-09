export class Vector2 {
    public x: number
    public y: number

    constructor(x: number = 0, y: number = 0) {
        this.x = x
        this.y = y
    }

    static clone(v: Vector2): Vector2 {
        return new Vector2(v.x, v.y)
    }

    static add(a: Vector2, b: Vector2): Vector2 {
        return new Vector2(a.x + b.x, a.y + b.y)
    }

    add(other: Vector2): Vector2 {
        this.x += other.x
        this.y += other.y
        return this
    }

    rotateLeft(): Vector2 {
        const px = this.x
        this.x = this.y
        this.y = -px
        return this
    }

    rotateRight(): Vector2 {
        const px = this.x
        this.x = -this.y
        this.y = px
        return this
    }

    equals(other: Vector2): boolean {
        return this.x === other.x && this.y === other.y
    }
}
