import * as React from "react"
import * as ReactDOM from "react-dom"

import {RenderState, View, stateController} from "../state_controller"
import {InitView} from "./init_view"
import {RegisterView} from "./register_view"
import {GameListView} from "./gamelist_view"
import {GamePlayView} from "./gameplay_view"

class Root extends React.Component<{}, RenderState> {
    constructor(props) {
        super(props)

        this.state = {
            currentView: View.Init,
            username: "",
            loggingIn: false,
            gamesList: [],
            gameState: null,
        }

        this.getView = this.getView.bind(this)
    }

    componentDidMount() {
        stateController.registerState(this.setState.bind(this), () => this.state)
    }

    getView(): JSX.Element {
        switch (this.state.currentView) {
            case View.Register:
                return (
                    <RegisterView
                        username={this.state.username}
                        loggingIn={this.state.loggingIn}
                    />
                )
            case View.GameList:
                return (
                    <GameListView
                        gamesList={this.state.gamesList}
                    />
                )
            case View.GamePlay:
                return <GamePlayView gameState={this.state.gameState} />
            default:
                return <InitView />
        }
    }

    render() {

        return (
            <div className="main-container">
                {this.getView()}
            </div>
        )
    }
}

export function initDom() {
    ReactDOM.render(
        <Root />,
        document.getElementById("root")
    )
}
