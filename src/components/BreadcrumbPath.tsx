
import React from 'react';
import {
    makeStyles,
    shorthands,
    Button,
    Input,
    Text,
    tokens,
} from '@fluentui/react-components';

import {
    ChevronRightRegular,
    FolderRegular,
    HardDriveRegular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
        ...shorthands.borderRadius('4px'),
        ...shorthands.padding('2px', '4px'),
        minHeight: '32px',
        flexGrow: 1,
    },
    segmentButton: {
        minWidth: 'auto',
        paddingLeft: '4px',
        paddingRight: '4px',
        fontWeight: 'normal',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        }
    },
    separator: {
        color: tokens.colorNeutralForeground3,
        marginLeft: '2px',
        marginRight: '2px',
    },
});

interface BreadcrumbPathProps {
    path: string;
    onNavigate: (path: string) => void;
}

export const BreadcrumbPath = ({ path, onNavigate }: BreadcrumbPathProps) => {
    const styles = useStyles();
    const [isEditing, setIsEditing] = React.useState(false);
    const [editValue, setEditValue] = React.useState(path);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        setEditValue(path);
        setIsEditing(false);
    }, [path]);

    React.useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    const handleSegmentClick = (index: number, segments: string[]) => {
        // Reconstruct path
        // Assumptions:
        // 1. If path starts with /, it's UNIX absolute
        // 2. If path starts with X:\, it's Windows absolute

        const isUnix = path.startsWith('/');
        const isWindows = /^[a-zA-Z]:\\/.test(path);

        let newPath = '';

        if (isUnix) {
            // segments[0] is empty string if path starts with /
            // e.g. /home/user -> ["", "home", "user"]
            const targetSegments = segments.slice(0, index + 1);
            newPath = targetSegments.join('/') || '/';
        } else if (isWindows) {
            // e.g. C:\Users -> ["C:", "Users"]
            const targetSegments = segments.slice(0, index + 1);
            newPath = targetSegments.join('\\');
            // Ensure backslash for drive root if just "C:"
            if (newPath.endsWith(':')) newPath += '\\';
        } else {
            // Fallback
            const targetSegments = segments.slice(0, index + 1);
            newPath = targetSegments.join(path.includes('\\') ? '\\' : '/');
        }

        onNavigate(newPath);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            onNavigate(editValue);
            setIsEditing(false);
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue(path);
        }
    };

    if (isEditing) {
        return (
            <div className={styles.container}>
                <Input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e, data) => setEditValue(data.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => { setIsEditing(false); setEditValue(path); }}
                    style={{ flexGrow: 1, border: 'none' }}
                />
            </div>
        );
    }

    // Parsing Path
    // Handle both / and \
    const separator = path.includes('\\') ? '\\' : '/';
    const segments = path.split(separator);

    // For UNIX paths like /home/user, split('/') gives ["", "home", "user"]
    // We want to render the root slash as the first element if it's empty

    return (
        <div
            className={styles.container}
            onClick={(e) => {
                // If clicked on the container background (not a button), switch to edit
                if (e.target === e.currentTarget) {
                    setIsEditing(true);
                }
            }}
        >
            {segments.map((segment, index) => {
                // Skip empty segments unless it's the first one (Root)
                if (segment === '' && index !== 0) return null;

                const isLast = index === segments.length - 1;


                let label = segment;
                let isRoot = false;

                if (index === 0 && segment === '') {
                    // It's the root slash for UNIX
                    label = '/';
                    isRoot = true;
                }

                if (index === 0 && segment === '' && path === '/') {
                    // Special case for root only
                    label = '/';
                    isRoot = true;
                }

                // If windows drive C:
                if (index === 0 && /^[a-zA-Z]:$/.test(segment)) {
                    label = segment + '\\'; // Show as Drive root
                }

                return (
                    <React.Fragment key={index}>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.segmentButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleSegmentClick(index, segments);
                            }}
                            icon={isRoot ? <HardDriveRegular /> : undefined}
                        >
                            {label}
                        </Button>
                        {!isLast && <ChevronRightRegular className={styles.separator} fontSize={12} />}
                    </React.Fragment>
                );
            })}

            {/* Filler to take up space and allow clicking to edit */}
            <div style={{ flexGrow: 1, alignSelf: 'stretch', cursor: 'text' }} onClick={() => setIsEditing(true)} />
        </div>
    );
};
