const write = (level, message, fields = {}) => {
    const entry = { timestamp: new Date().toISOString(), level, message, ...fields };
    const output = JSON.stringify(entry);
    (level === "error" ? console.error : console.log)(output);
};

export const logger = {
    info: (message, fields) => write("info", message, fields),
    error: (message, fields) => write("error", message, fields),
};
