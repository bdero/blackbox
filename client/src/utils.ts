export function parseQueryParameters(): {[key: string]: string} {
    const urlParameters = {}
    location.search
        .substr(1)
        .split("&")
        .forEach((item) => {
            const [key, value] = item.split("=")
            urlParameters[key] = value
        })
    return urlParameters
}
