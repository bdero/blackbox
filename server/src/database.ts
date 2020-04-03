import {exec} from "child_process"
import fs = require("fs")
import path = require("path")
import util = require("util")

import {Sequelize, DataTypes, Model} from "sequelize"

const promiseExec = util.promisify(exec)

const databasePath = path.join(process.cwd(), "data", "blackbox.db")

const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: databasePath
})

class Player extends Model {}
Player.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    displayName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    secretKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    timeCreated: {
        type: DataTypes.DATE,
        allowNull: false,
    },
}, {
    sequelize,
    modelName: "Player",
});

class GameSession extends Model {}
GameSession.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    inviteCode: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    timeCreated: {
        type: DataTypes.DATE,
        allowNull: false,
    },
}, {
    sequelize,
    modelName: "GameSession",
})

class GameSessionSeat extends Model {}
GameSessionSeat.init({
    seatNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            isValidSeatNumber(value) {
                if (!(value === 0 || value === 1)) {
                    throw new Error("Seat number must only be set to 0 or 1")
                }
            }
        }
    },
}, {
    sequelize,
    modelName: "GameSessionSeat",
})

// "Super Many-to-Many":
// https://sequelize.org/master/manual/advanced-many-to-many.html#the-best-of-both-worlds--the-super-many-to-many-relationship
Player.belongsToMany(GameSession, {through: GameSessionSeat})
GameSession.belongsToMany(Player, {through: GameSessionSeat})
Player.hasMany(GameSessionSeat)
GameSessionSeat.belongsTo(Player)
GameSession.hasMany(GameSessionSeat)
GameSessionSeat.belongsTo(GameSession)

async function initDatabase() {
    console.log(`Database path: ${databasePath}`)
    
    const results = await promiseExec(`sqlite3 ${databasePath} ".databases"`)
    console.log(`sqlite3 stdout:\n${results.stdout}`)
    console.log(`sqlite3 stderr:\n${results.stderr}`)

    await sequelize.sync();
}

export {initDatabase, Player, GameSession, GameSessionSeat}
