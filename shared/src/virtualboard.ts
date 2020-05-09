import {Vector2} from './math'

/**
 * An lightweight representation of the blackbox game board for computing rays.
 *
 * There should only ever need to be one per browser or server runtime, and so one instance is exported for global use.
 * This avoids reallocating the 8x8 grid by keeping track of submitted atoms, so that whenever a new set of atoms is submitted,
 * the board is wiped clean.
 * Because this lightweight resource is shared between multiple game boards to prevent constant reallocation of the 8x8 board,
 * always call "setAtoms" to clear the board immediately before computing sets of raycasts with "castRay".
 */
class VirtualBoard {
    board: Array<Array<boolean>>
    atoms: Vector2[]

    constructor() {
        this.board = []
        for (let i = 0; i < 10; i++) {
            this.board.push([])
            for (let j = 0; j < 10; j++) {
                this.board[i].push(false)
            }
        }
        this.atoms = []
    }

    clearAtoms() {
        this.atoms.forEach(a => this.board[a.x][a.y] = false)
        this.atoms = []
    }

    setAtoms(...atoms: Vector2[]) {
        this.clearAtoms()
        this.atoms.push(...atoms)
        this.atoms.forEach(a => this.board[a.x][a.y] = true)
    }

    static isSide(cell: Vector2): boolean {
        return cell.x <= 0 || cell.x >= 9 || cell.y <= 0 || cell.y >= 9
    }

    isHit(cell: Vector2): boolean {
        return !VirtualBoard.isSide(cell) && this.board[cell.x][cell.y]
    }

    // 10x10 board origin
    castRay(origin: Vector2): Vector2[] | null {
        let dir = new Vector2(
            origin.x === 0 ? 1 : origin.x === 9 ? -1 : 0,
            origin.y === 0 ? 1 : origin.y === 9 ? -1 : 0)
        if (dir.x === 0 && dir.y === 0) return null
        const resultPath: Vector2[] = [Vector2.clone(origin)]

        const getForwardCell = () => Vector2.add(currentCell, dir)
        const getForwardLeftCell = () => Vector2.clone(dir).rotateLeft().add(dir).add(currentCell)
        const getForwardRightCell = () => Vector2.clone(dir).rotateRight().add(dir).add(currentCell)

        let currentCell = Vector2.clone(origin)
        while (!VirtualBoard.isSide(currentCell) || (resultPath.length === 1 && currentCell.equals(resultPath[0]))) {
            if (this.isHit(getForwardCell())) {
                currentCell.add(dir)
                break
            }
            const forwardLeftIsHit = this.isHit(getForwardLeftCell())
            const forwardRightIsHit = this.isHit(getForwardRightCell())
            if (VirtualBoard.isSide(currentCell) && (forwardLeftIsHit || forwardRightIsHit)) {
                break
            }
            if (forwardLeftIsHit && forwardRightIsHit) {
                resultPath.push(Vector2.clone(currentCell))
                dir.rotateRight().rotateRight()
                currentCell.add(dir)
                continue
            }
            if (forwardLeftIsHit) {
                resultPath.push(Vector2.clone(currentCell))
                dir.rotateRight()
                currentCell.add(dir)
                continue
            }
            if (forwardRightIsHit) {
                resultPath.push(Vector2.clone(currentCell))
                dir.rotateLeft()
                currentCell.add(dir)
                continue
            }
            currentCell.add(dir)
        }

        resultPath.push(currentCell)
        return resultPath
    }
}
export default new VirtualBoard()
