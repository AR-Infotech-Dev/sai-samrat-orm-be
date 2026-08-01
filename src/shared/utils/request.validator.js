// VALIDATE SCHEMAS 
export const validate = (schema, data) => {

    const { error, value } = schema.validate(data,
        {allowUnknown: false}
    );

    if (error) {
        return {
            isValid: false,
            message: error.details[0].message,
            field: error.details[0].path[0]
        };
    }

    return {
        isValid: true,
        value
    };
};
