//! The view model. Every control is resolved to exactly what the template
//! prints, so the template branches on a variant and never computes.

use crate::cfg::{Form, get};
use crate::schema::{FIELDS, Field};
use askama::Template;

/// `f-background-motion`, `f-icon-ship` -- the ids index.html and the CSS use.
fn id(path: &str, value: Option<&str>) -> String {
    let base = format!("f-{}", path.replace('.', "-"));
    match value {
        Some(v) => format!("{base}-{v}"),
        None => base,
    }
}

pub struct Opt {
    pub id: String,
    pub value: String,
    pub checked: bool,
}

pub enum Control {
    Number {
        id: String,
        name: &'static str,
        label: &'static str,
        min: i64,
        max: i64,
        step: i64,
        value: String,
    },
    Seg {
        name: &'static str,
        label: &'static str,
        options: Vec<Opt>,
    },
    Toggle {
        id: String,
        name: &'static str,
        label: &'static str,
        checked: bool,
    },
    Color {
        id: String,
        name: &'static str,
        label: &'static str,
        swatch: String,
        full: String,
    },
}

fn radios(path: &'static str, label: &'static str, values: &[&'static str], current: &str) -> Control {
    Control::Seg {
        name: path,
        label,
        options: values
            .iter()
            .map(|v| Opt {
                id: id(path, Some(v)),
                value: (*v).to_string(),
                checked: *v == current,
            })
            .collect(),
    }
}

/// `None` renders the schema's defaults -- a first GET, where no form has been
/// posted yet. `Some(form)` renders what the reader last sent back.
pub fn controls(form: Option<&Form>) -> Vec<Control> {
    let value = |path: &str| form.and_then(|f| get(f, path));
    FIELDS
        .iter()
        .map(|field| match field {
            Field::Number { path, label, min, max, step, def } => Control::Number {
                id: id(path, None),
                name: path,
                label,
                min: *min,
                max: *max,
                step: *step,
                value: value(path).map(str::to_string).unwrap_or_else(|| def.to_string()),
            },
            Field::Enum { path, label, values, def } => {
                radios(path, label, values, value(path).unwrap_or(def))
            }
            Field::Choice { path, label, branches, def } => {
                radios(path, label, branches, value(path).unwrap_or(def))
            }
            Field::Toggle { path, label, def } => Control::Toggle {
                id: id(path, None),
                name: path,
                label,
                checked: match form {
                    Some(f) => get(f, path).is_some(),
                    None => *def,
                },
            },
            Field::Color { path, label, def } => {
                let full = value(path)
                    .map(|v| {
                        // the posted value is #rrggbb; the output shows the
                        // value the config will carry, alpha included
                        let alpha = if def.len() == 9 { &def[7..] } else { "" };
                        format!("{v}{alpha}")
                    })
                    .unwrap_or_else(|| def.to_string());
                Control::Color {
                    id: id(path, None),
                    name: path,
                    label,
                    swatch: full.chars().take(7).collect(),
                    full,
                }
            }
        })
        .collect()
}

#[derive(Template)]
#[template(path = "page.html")]
pub struct Page {
    /// "dark", "light", or "" when no cookie has been set yet
    pub theme: &'static str,
    pub controls: Vec<Control>,
    pub resolutions: &'static [(&'static str, (u32, u32))],
    pub res: String,
    pub res_custom: String,
    /// "" means the banner is hidden
    pub error: String,
    pub svg: String,
}

#[derive(Template)]
#[template(path = "preview.html")]
pub struct Preview {
    pub svg: String,
    pub error: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_check_the_schema_default_in_every_group() {
        let cs = controls(None);
        let checked: Vec<&str> = cs
            .iter()
            .filter_map(|c| match c {
                Control::Seg { options, .. } => {
                    options.iter().find(|o| o.checked).map(|o| o.value.as_str())
                }
                _ => None,
            })
            .collect();
        assert_eq!(checked, ["STATIC", "NONE", "hexatri", "ROTATE"]);
    }

    #[test]
    fn a_posted_form_wins_over_the_schema_default() {
        let form: Form = vec![("background.motion".into(), "SCAN".into())];
        let cs = controls(Some(&form));
        let Control::Seg { options, .. } = &cs[1] else { panic!("field 1 is a segmented control") };
        assert!(options.iter().find(|o| o.value == "SCAN").unwrap().checked);
        assert!(!options.iter().find(|o| o.value == "STATIC").unwrap().checked);
    }

    #[test]
    fn the_colour_swatch_drops_the_alpha_and_the_output_keeps_it() {
        let cs = controls(None);
        let Control::Color { swatch, full, .. } = cs.last().unwrap() else {
            panic!("the last field is the colour")
        };
        assert_eq!(swatch, "#395e53");
        assert_eq!(full, "#395e53b3");
    }

    #[test]
    fn the_ids_are_the_ones_the_stylesheet_selects() {
        let cs = controls(None);
        let ids: Vec<String> = cs
            .iter()
            .flat_map(|c| match c {
                Control::Seg { options, .. } => options.iter().map(|o| o.id.clone()).collect(),
                Control::Number { id, .. } | Control::Toggle { id, .. } | Control::Color { id, .. } => {
                    vec![id.clone()]
                }
            })
            .collect();
        // assets/styles.css selects both of these by id
        assert!(ids.contains(&"f-icon-ship".to_string()), "{ids:?}");
        assert!(ids.contains(&"f-overlay-matrix".to_string()), "{ids:?}");
    }

    #[test]
    fn the_page_renders_the_markup_the_stylesheet_expects() {
        let html = Page {
            theme: "dark",
            controls: controls(None),
            resolutions: &bgsvg::params::RESOLUTIONS,
            res: "1080p".into(),
            res_custom: String::new(),
            error: String::new(),
            svg: "<svg id=\"x\"/>".into(),
        }
        .render()
        .expect("the page template renders");

        for needle in [
            "<html lang=\"en\" data-theme=\"dark\">",
            "id=\"stage\"",
            "hx-post=\"/preview\"",
            "<form id=\"cfg\" method=\"post\"",
            "id=\"f-icon-ship\"",
            "name=\"background.motion\"",
            "id=\"f-overlay-matrix\"",
            "formaction=\"/theme\"",
            "formaction=\"/download.svg\"",
            "<option value=\"1080p\" selected>",
            "<svg id=\"x\"/>",
            "id=\"error\" role=\"alert\" hidden",
        ] {
            assert!(html.contains(needle), "missing {needle}\n{html}");
        }
    }

    #[test]
    fn the_error_banner_shows_and_escapes_what_the_renderer_said() {
        let html = Preview {
            svg: "<svg/>".into(),
            error: "rejected <script>".into(),
        }
        .render()
        .unwrap();
        assert!(html.contains("hx-swap-oob=\"true\""));
        assert!(!html.contains(" hidden"));
        assert!(html.contains("&#60;script&#62;"), "the message is escaped: {html}");
        assert!(html.contains("<svg/>"), "the render is not: {html}");
    }
}
