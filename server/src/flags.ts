interface CliFlag<T> {
    value: T,
    convert: (s: string) => {result: T | null, error: string}
}

function numberFlag(value: number): CliFlag<number> {
    return {
        value: value,
        convert: (s) => {
            const num = Number(s);
            if (num === NaN) {
                return {result: null, error: `Value ${s} is not a number`}
            }
            return {result: num, error: ""}
        }
    }
}

const cliFlags = {
    "--port": numberFlag(8888),
}

let index = 0;
while (index < process.argv.length) {
    const param = process.argv[index]
    if (param.startsWith("--")) {
        if (!(param in cliFlags)) {
            console.error(`Error: Command line parameter "${param}" is not valid`)
            process.exit(1)
        }
        if (index + 1 >= process.argv.length) {
            console.error(`Error: Command line parameter "${param}" must have a corresponding value`)
            process.exit(1)
        }
        
        const valueString = process.argv[index + 1]
        const value = cliFlags[param].convert(valueString);
        if (value.result === null) {
            console.error(`Error: Invalid value for parameter "${param}"; ${value.error}`)
            process.exit(1)
        }
        cliFlags[param].value = value.result
        index += 1
    }
    index += 1

}

export default cliFlags;

