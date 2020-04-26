import * as React from "react"

import * as Views from "../views"
import {stateController} from "../state_controller"

export class RegisterView extends React.Component<{username: string, loggingIn: boolean}> {
    constructor(props) {
        super(props)
        this.state = {
            username: "",
            loggingIn: false,
        }
    }
    submit() {
        stateController.setState({loggingIn: true})
        Views.login({
            username: this.props.username,
            key: null
        }, true)
    }
    render() {
        return (
            <div>
                <input
                    placeholder="Nickname"
                    value={this.props.username}
                    onChange={e => stateController.setState({username: e.target.value})}
                    disabled={this.props.loggingIn}
                />
                <button
                    onClick={e => this.submit()}
                    disabled={this.props.loggingIn}>
                    Play
                </button>
            </div>
        )
    }
}
