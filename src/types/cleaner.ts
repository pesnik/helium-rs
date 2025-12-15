export interface JunkItem {
    path: string;
    name: string;
    size: number;
    description: string;
}

export interface JunkCategory {
    id: string;
    name: string;
    description: string;
    items: JunkItem[];
    total_size: number;
    icon: string;
}
