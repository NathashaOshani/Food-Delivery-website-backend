import crypto from "node:crypto";
import { hasOnlyFields } from "./validation.js";

export const validVariantId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
export const cakeDesigns = [
    { id: "blue-teddy", name: "Blue Teddy" },
    { id: "pink-teddy", name: "Pink Teddy" },
    { id: "strawberry", name: "Strawberry" },
    { id: "chocolate-drip", name: "Chocolate Drip" },
];
export const cartKey = (itemId, variantId, designId) => `${itemId}${variantId ? `:${variantId}` : ""}${designId ? `:${designId}` : ""}`;
export const splitCartKey = (key) => {
    const [itemId, variantId, designId, extra] = key.split(":");
    const hasDesign = designId !== undefined;
    return { itemId, variantId, designId: hasDesign ? designId : undefined,
        valid: /^[a-f0-9]{24}$/.test(itemId) && extra === undefined &&
            (variantId === undefined || validVariantId(variantId)) &&
            (!hasDesign || (validVariantId(variantId) && cakeDesigns.some((design) => design.id === designId))) };
};
export const validPrice = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0.01 && value <= 100000 && Math.abs(Math.round(value * 100) - value * 100) < 1e-8;

export const normalizeVariants = (input, current = []) => {
    if (input === undefined) return current;
    let values = input;
    if (typeof values === "string") {
        try { values = JSON.parse(values); } catch { throw new Error("Options must be a valid JSON array"); }
    }
    if (!Array.isArray(values) || values.length > 12) throw new Error("A food can have up to 12 options");
    const names = new Set();
    const ids = new Set();
    return values.map((value) => {
        if (!hasOnlyFields(value, ["id", "name", "price"])) throw new Error("Unknown option field");
        const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
        if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Option names must be 1-40 characters");
        if (names.has(name.toLowerCase())) throw new Error("Option names must be unique");
        if (!validPrice(value.price)) throw new Error("Each option needs a price between 0.01 and 100000 with at most two decimal places");
        if (value.id !== undefined && (!validVariantId(value.id) || !current.some((option) => option.id === value.id))) throw new Error("Unknown option id");
        const id = value.id || crypto.randomBytes(12).toString("hex");
        if (ids.has(id)) throw new Error("Duplicate option id");
        names.add(name.toLowerCase()); ids.add(id);
        return { id, name, price: value.price };
    });
};

export const normalizeDesignOptions = (input, current = {}) => {
    if (input === undefined) return current.designOptions || [];
    let values = input;
    if (typeof values === "string") {
        try { values = JSON.parse(values); } catch { throw new Error("Birthday cake options must be a valid JSON array"); }
    }
    if (!Array.isArray(values) || values.length !== cakeDesigns.length) throw new Error("Add size and price options for all four birthday cake designs");
    const seen = new Set();
    return cakeDesigns.map((design) => {
        const value = values.find((entry) => entry?.designId === design.id);
        if (!value || !hasOnlyFields(value, ["designId", "variants"]) || seen.has(value.designId)) throw new Error("Each birthday cake design needs its own options");
        seen.add(value.designId);
        const currentOptions = current.designOptions?.find((entry) => entry.designId === design.id)?.variants || current.variants || [];
        const variants = normalizeVariants(value.variants, currentOptions);
        if (!variants.length) throw new Error(`Add at least one size and price for ${design.name}`);
        return { designId: design.id, variants };
    });
};

export const selectVariant = (food, variantId, designId) => {
    const designOptions = food.name.trim().toLowerCase() === "birthday cake" && food.designOptions?.length
        ? food.designOptions.find((entry) => entry.designId === designId)?.variants || []
        : food.variants || [];
    if (food.name.trim().toLowerCase() === "birthday cake" && food.designOptions?.length && !designId) {
        throw new Error("Choose a birthday cake design first");
    }
    if (designOptions.length) {
        const variant = designOptions.find((option) => option.id === variantId);
        if (!variant) throw new Error(`Choose a valid option for ${food.name}`);
        return variant;
    }
    if (variantId !== undefined) throw new Error(`This option is no longer available for ${food.name}`);
    return null;
};

export const selectDesign = (food, designId) => {
    const isBirthdayCake = food.name.trim().toLowerCase() === "birthday cake";
    if (!isBirthdayCake) {
        if (designId !== undefined) throw new Error(`Design selection is not available for ${food.name}`);
        return null;
    }
    const design = cakeDesigns.find((option) => option.id === designId);
    if (!design) throw new Error("Choose a birthday cake design");
    return design;
};
