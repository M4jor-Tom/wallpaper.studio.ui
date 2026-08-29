//! What the form offers. This is the one place this repository restates
//! something `parameters.proto` already says, which is why the drift test at
//! the bottom fails when the two disagree.
//!
//! `path` is a dotted path into the config JSON, and it is also each control's
//! `name` attribute -- form encoding keys on `name`, so the two are one thing.
//! A `oneof` is a `Choice`: its value names which branch is present.

pub enum Field {
    Number {
        path: &'static str,
        label: &'static str,
        min: i64,
        max: i64,
        step: i64,
        def: i64,
    },
    Enum {
        path: &'static str,
        label: &'static str,
        values: &'static [&'static str],
        def: &'static str,
    },
    Choice {
        path: &'static str,
        label: &'static str,
        branches: &'static [&'static str],
        def: &'static str,
    },
    Toggle {
        path: &'static str,
        label: &'static str,
        def: bool,
    },
    Color {
        path: &'static str,
        label: &'static str,
        def: &'static str,
    },
}

impl Field {
    pub fn path(&self) -> &'static str {
        match self {
            Field::Number { path, .. }
            | Field::Enum { path, .. }
            | Field::Choice { path, .. }
            | Field::Toggle { path, .. }
            | Field::Color { path, .. } => path,
        }
    }
}

pub static FIELDS: &[Field] = &[
    Field::Number { path: "seed", label: "Seed", min: 0, max: 4294967295, step: 1, def: 0 },
    Field::Enum {
        path: "background.motion",
        label: "Background motion",
        values: &["STATIC", "SCAN", "LIGHTS", "CLOSEOPEN"],
        def: "STATIC",
    },
    Field::Enum {
        path: "background.image",
        label: "Background image",
        values: &["NONE", "STARFIELD"],
        def: "NONE",
    },
    Field::Choice {
        path: "icon",
        label: "Icon",
        branches: &["hexatri", "ship"],
        def: "hexatri",
    },
    Field::Enum {
        path: "icon.hexatri.motion",
        label: "Icon motion",
        values: &["ROTATE", "STATIC"],
        def: "ROTATE",
    },
    Field::Toggle { path: "overlay.matrix", label: "Matrix rain", def: false },
    Field::Number {
        path: "overlay.matrix.angle",
        label: "Rain angle",
        min: 0,
        max: 360,
        step: 1,
        def: 0,
    },
    Field::Color {
        path: "overlay.matrix.color",
        label: "Rain colour",
        def: "#395e53b3",
    },
];

/// The proto enum each control corresponds to. Only the *names* live here --
/// the values come from FIELDS, so the list the form offers and the list the
/// drift test verifies cannot disagree.
#[cfg(test)]
const ENUM_PROTO_NAMES: &[(&str, &str)] = &[
    ("background.motion", ".svg_builder.Background.Motion"),
    ("background.image", ".svg_builder.Background.Image"),
    ("icon.hexatri.motion", ".svg_builder.Hexatri.Motion"),
];

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;
    use prost_types::{DescriptorProto, FileDescriptorSet};
    use std::collections::BTreeMap;

    type Enums = BTreeMap<String, Vec<String>>;

    /// What the form declares, keyed by proto name.
    fn declared() -> Enums {
        let mut out = Enums::new();
        for f in FIELDS {
            if let Field::Enum { path, values, .. } = f {
                let name = ENUM_PROTO_NAMES
                    .iter()
                    .find(|(p, _)| p == path)
                    .map(|(_, n)| (*n).to_string())
                    .unwrap_or_else(|| format!("UNMAPPED:{path}"));
                out.insert(name, values.iter().map(|v| (*v).to_string()).collect());
            }
        }
        out
    }

    fn walk(prefix: &str, m: &DescriptorProto, out: &mut Enums) {
        for e in &m.enum_type {
            out.insert(
                format!("{prefix}.{}", e.name()),
                e.value.iter().map(|v| v.name().to_string()).collect(),
            );
        }
        for n in &m.nested_type {
            walk(&format!("{prefix}.{}", n.name()), n, out);
        }
    }

    /// Every enum in the locked renderer's own descriptor, fully qualified.
    fn found() -> Enums {
        let set = FileDescriptorSet::decode(bgsvg::params::DESCRIPTOR)
            .expect("bgsvg::params::DESCRIPTOR is a FileDescriptorSet");
        let mut out = Enums::new();
        for file in &set.file {
            let pkg = file.package();
            for e in &file.enum_type {
                out.insert(
                    format!(".{pkg}.{}", e.name()),
                    e.value.iter().map(|v| v.name().to_string()).collect(),
                );
            }
            for m in &file.message_type {
                walk(&format!(".{pkg}.{}", m.name()), m, &mut out);
            }
        }
        out
    }

    /// The whole comparison in one place, so the test asserts on exactly what a
    /// developer would be told.
    fn compare(declared: &Enums, found: &Enums) -> Vec<String> {
        // Zero enums parsed is indistinguishable from zero drift, so refuse to
        // report success on a descriptor we plainly failed to read.
        if found.len() < declared.len() {
            return vec![format!(
                "parsed {} enums but the form declares {} -- the descriptor was unreadable, not clean",
                found.len(),
                declared.len()
            )];
        }
        let mut problems = Vec::new();
        for (name, values) in found {
            let Some(want) = declared.get(name) else {
                problems.push(format!(
                    "{name}: the schema has this enum; src/schema.rs does not declare it"
                ));
                continue;
            };
            for v in values {
                if !want.contains(v) {
                    problems.push(format!("{name}.{v}: in parameters.proto, not offered by the form"));
                }
            }
            // the reverse direction: a value the form offers that upstream
            // removed would render a control the renderer rejects
            for d in want {
                if !values.contains(d) {
                    problems.push(format!("{name}.{d}: offered by the form, not in parameters.proto"));
                }
            }
        }
        problems
    }

    #[test]
    fn the_form_offers_every_enum_value_the_schema_has() {
        let problems = compare(&declared(), &found());
        assert!(
            problems.is_empty(),
            "drift: {} problem(s)\n  {}\n\nadd the value to FIELDS (and ENUM_PROTO_NAMES if this is a new enum)",
            problems.len(),
            problems.join("\n  ")
        );
    }

    /// compare() is only trustworthy if it can fail. An enum the form does not
    /// declare at all must be reported, not skipped.
    #[test]
    fn compare_reports_an_undeclared_enum() {
        let mut found = Enums::new();
        found.insert(".a.B".into(), vec!["X".into()]);
        found.insert(".a.C".into(), vec!["Y".into()]);
        let mut declared = Enums::new();
        declared.insert(".a.B".into(), vec!["X".into()]);
        let problems = compare(&declared, &found);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains(".a.C"), "{}", problems[0]);
    }
}
