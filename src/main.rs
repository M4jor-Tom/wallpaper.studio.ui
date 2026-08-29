mod cfg;
mod page;
mod schema;

fn main() {}

#[cfg(test)]
mod tests {
    /// The whole point of the migration: the renderer is a function call, not
    /// a module to instantiate. If this fails, nothing below it matters.
    #[test]
    fn the_renderer_is_linked() {
        let svg = bgsvg::render_to_string("{}", 640, 360).expect("the empty config renders");
        assert!(svg.starts_with("<svg"), "expected an SVG document, got {:.40}", svg);
    }
}
