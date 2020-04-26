import * as React from "react"

import * as Views from "../views"
import {GameMetadata} from "../shared/src/messages"

class GameListItem extends React.Component<{game: GameMetadata}> {
    constructor(props) {
        super(props)

        this.joinGameClicked = this.joinGameClicked.bind(this)
    }

    joinGameClicked() {
        Views.joinGame(false, this.props.game.inviteCode)
    }

    render() {
        return (
            <tr>
                <td>{this.props.game.status}</td>
                <td>{this.props.game.inviteCode}</td>
                <td><button onClick={this.joinGameClicked}>Join game</button></td>
            </tr>
        )
    }
}

export class GameListView extends React.Component<{gamesList: GameMetadata[]}> {
    newGameClicked() {
        Views.joinGame(true)
    }

    getListContents(): JSX.Element {
        if (this.props.gamesList.length === 0) {
            return <h1>No games started!</h1>
        }

        const listItems: JSX.Element[] = this.props.gamesList.map(
            g => <GameListItem key={g.inviteCode} game={g} />
        )
        return (
            <table>
                <tbody>
                    {listItems}
                </tbody>
            </table>
        )
    }

    render() {
        return (
            <div>
                {this.getListContents()}
                <button onClick={this.newGameClicked}>New game</button>
            </div>
        )
    }
}
