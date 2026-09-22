# -*- coding: utf-8 -*-
"""Tests for request-time image resizing (qwenpaw.utils.image_resize).

Covers:
- ``get_max_image_pixels``: unset/empty/zero disable resizing, whitespace and
  ``+``/``_`` integer spellings accepted, every non-integer and negative
  spelling rejected with an actionable message naming the variable.
- ``_resized_dimensions``: the pixel budget is never exceeded, both sides stay
  >= 1, each side of the shrink loop is reached, degenerate budgets are
  rejected or clamped (unreachable through the public entry point).
- ``_image_save_options``: only a truthy ICC profile is carried over, and it is
  carried over by identity.
- ``resize_base64_image``: resizing is skipped when disabled or unnecessary
  (the caller's string is returned unchanged), the four whitelisted formats are
  resized, non-whitelisted formats and animated images are rejected, decode and
  decompression-bomb failures surface as configuration errors, the JPEG colour
  conversion branch runs, ICC profiles survive, and the output is deterministic
  ASCII base64.
- ``_provider_max_pixels``: both provider message shapes, digit separators, and
  the guarantee that the regex charset keeps ``int()`` from ever failing.
- ``image_pixel_limit_hint``: each of the six reachable outcomes is distinct,
  messages are whitespace-normalised and case-insensitive, and a broken
  configuration is reported instead of a hint.
"""

from __future__ import annotations

import base64
import re
from io import BytesIO

import pytest
from PIL import Image

from qwenpaw.utils import image_resize

# pylint: disable=protected-access,use-implicit-booleaness-not-comparison  # noqa: E501

ENV = image_resize.MAX_IMAGE_PIXELS_ENV


def _encode(image: Image.Image, fmt: str, **kwargs) -> str:
    buffer = BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _solid_png(size: tuple[int, int], color: str = "navy") -> str:
    return _encode(Image.new("RGB", size, color), "PNG")


def _animated_gif(size: tuple[int, int]) -> str:
    """Build a genuinely animated GIF.

    PIL drops duplicate frames, so the frames must differ in colour; identical
    palette-colour frames collapse to a single-frame still image.
    """
    frames = [
        Image.new("RGB", size, color) for color in ("red", "green", "blue")
    ]
    return _encode(
        frames[0],
        "GIF",
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0,
    )


def _decode(data: str) -> Image.Image:
    return Image.open(BytesIO(base64.b64decode(data)))


class TestGetMaxImagePixels:
    """The environment variable is the only resizing switch."""

    @pytest.mark.parametrize(
        "raw",
        [None, "", "   ", "\t\n", "0", " 0 ", "-0"],
    )
    def test_unset_empty_and_zero_disable_resizing(self, monkeypatch, raw):
        if raw is None:
            monkeypatch.delenv(ENV, raising=False)
        else:
            monkeypatch.setenv(ENV, raw)
        assert image_resize.get_max_image_pixels() == 0

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("1", 1),
            ("4096", 4096),
            ("  4096  ", 4096),
            ("+5", 5),
            ("1_000", 1000),
            ("1000000", 1000000),
        ],
    )
    def test_positive_integers_are_parsed(self, monkeypatch, raw, expected):
        monkeypatch.setenv(ENV, raw)
        assert image_resize.get_max_image_pixels() == expected

    def test_arbitrarily_large_budget_is_not_truncated(self, monkeypatch):
        monkeypatch.setenv(ENV, str(10**30))
        assert image_resize.get_max_image_pixels() == 10**30

    @pytest.mark.parametrize(
        "raw",
        [
            "abc",
            "null",
            "True",
            "none",
            "1.5",
            "1e5",
            "0x10",
            "10**100",
            "nan",
            "inf",
            "-inf",
            "1,000",
            "-1",
            " -7 ",
            "1 000",
            "4096px",
        ],
    )
    def test_invalid_values_raise_an_actionable_error(self, monkeypatch, raw):
        monkeypatch.setenv(ENV, raw)
        with pytest.raises(ValueError, match=re.escape(ENV)) as excinfo:
            image_resize.get_max_image_pixels()
        message = str(excinfo.value)
        assert "must be zero or a positive integer" in message
        assert repr(raw.strip()) in message

    def test_error_chains_the_underlying_parse_failure(self, monkeypatch):
        monkeypatch.setenv(ENV, "abc")
        with pytest.raises(ValueError) as excinfo:
            image_resize.get_max_image_pixels()
        assert isinstance(excinfo.value.__cause__, ValueError)


class TestResizedDimensions:
    """Proportional downscaling that must always fit the budget."""

    def test_dimensions_at_the_budget_are_left_untouched(self):
        assert image_resize._resized_dimensions(100, 100, 10000) == (100, 100)

    def test_dimensions_just_over_the_budget_shrink_by_one(self):
        assert image_resize._resized_dimensions(100, 100, 9999) == (99, 99)

    @pytest.mark.parametrize(
        ("width", "height", "budget"),
        [
            (1920, 1080, 500000),
            (1000, 10, 1000),
            (10, 1000, 1000),
            (3, 3, 1),
            (7, 5, 6),
            (4, 4, 3),
            (200, 200, 9999),
        ],
    )
    def test_result_never_exceeds_the_budget(self, width, height, budget):
        resized_width, resized_height = image_resize._resized_dimensions(
            width,
            height,
            budget,
        )
        assert resized_width * resized_height <= budget

    def test_both_sides_stay_at_least_one_pixel(self):
        for width in range(1, 40):
            for height in range(1, 40):
                (
                    resized_width,
                    resized_height,
                ) = image_resize._resized_dimensions(
                    width,
                    height,
                    1,
                )
                assert resized_width >= 1
                assert resized_height >= 1

    def test_budget_is_never_exceeded_across_a_dense_grid(self):
        budgets = (1, 2, 3, 5, 7, 11, 50, 101, 999, 1000)
        for width in range(1, 60):
            for height in range(1, 60):
                for budget in budgets:
                    if width * height <= budget:
                        continue
                    (
                        resized_width,
                        resized_height,
                    ) = image_resize._resized_dimensions(width, height, budget)
                    assert resized_width * resized_height <= budget, (
                        width,
                        height,
                        budget,
                    )
                    assert resized_width >= 1 and resized_height >= 1

    def test_aspect_ratio_stays_close_to_proportional(self):
        width, height, budget = 1920, 1080, 500000
        resized_width, resized_height = image_resize._resized_dimensions(
            width,
            height,
            budget,
        )
        drift = abs((width / height) - (resized_width / resized_height))
        assert drift < 0.01

    def test_wide_images_shrink_the_width_side_of_the_loop(self):
        # ``max(1, ...)`` clamps the short side to 1, so the loop can only
        # decrement the long side; this reaches the width branch.
        resized_width, resized_height = image_resize._resized_dimensions(
            5000,
            3,
            100,
        )
        assert (resized_width, resized_height) == (100, 1)

    def test_tall_images_shrink_the_height_side_of_the_loop(self):
        resized_width, resized_height = image_resize._resized_dimensions(
            3,
            5000,
            100,
        )
        assert (resized_width, resized_height) == (1, 100)

    def test_square_inputs_never_need_the_shrink_loop(self):
        # Documented behaviour: flooring a square already satisfies the budget,
        # so the loop body is only reachable for clamped aspect ratios.
        for side in range(2, 400):
            budget = side * side - 1
            resized_width, resized_height = image_resize._resized_dimensions(
                side,
                side,
                budget,
            )
            assert resized_width * resized_height <= budget

    def test_zero_budget_is_unreachable_but_clamps_width_to_zero(self):
        # ``resize_base64_image`` returns before scaling when the budget is not
        # positive, so this documents the helper alone.
        assert image_resize._resized_dimensions(2, 3, 0) == (0, 1)

    def test_negative_budget_raises_a_math_domain_error(self):
        with pytest.raises(ValueError, match="math domain error"):
            image_resize._resized_dimensions(5, 5, -1)

    @pytest.mark.parametrize("size", [(0, 5), (5, 0), (0, 0)])
    def test_zero_sided_input_raises_zero_division(self, size):
        with pytest.raises(ZeroDivisionError):
            image_resize._resized_dimensions(size[0], size[1], 10)


class TestImageSaveOptions:
    """Only a usable ICC profile is retained in the resized copy."""

    def test_image_without_profile_yields_no_options(self):
        assert image_resize._image_save_options(Image.new("RGB", (4, 4))) == {}

    @pytest.mark.parametrize("profile", [b"", None])
    def test_falsy_profile_is_dropped(self, profile):
        image = Image.new("RGB", (4, 4))
        image.info["icc_profile"] = profile
        assert image_resize._image_save_options(image) == {}

    def test_profile_is_passed_through_by_identity(self):
        profile = b"\x00\x00\x02\x0cADBE\x02\x10\x00\x00mntrRGB"
        image = Image.new("RGB", (4, 4))
        image.info["icc_profile"] = profile
        options = image_resize._image_save_options(image)
        assert list(options) == ["icc_profile"]
        assert options["icc_profile"] is profile


class TestResizeBase64Image:
    """The single entry point used by the request pipeline."""

    @pytest.mark.parametrize("budget", [0, -1, -100000])
    def test_disabled_resizing_returns_the_input_object(self, budget):
        data = "!!!not even base64!!!"
        result, changed = image_resize.resize_base64_image(data, budget)
        assert changed is False
        assert result is data

    def test_image_within_budget_is_returned_unchanged(self):
        data = _solid_png((10, 10))
        result, changed = image_resize.resize_base64_image(data, 100000)
        assert changed is False
        assert result is data

    def test_image_exactly_at_the_budget_is_not_resized(self):
        data = _solid_png((100, 100))
        result, changed = image_resize.resize_base64_image(data, 10000)
        assert changed is False
        assert result is data

    def test_image_one_pixel_over_the_budget_is_resized(self):
        data = _solid_png((100, 100))
        result, changed = image_resize.resize_base64_image(data, 9999)
        assert changed is True
        with _decode(result) as resized:
            assert resized.size == (99, 99)
            assert resized.size[0] * resized.size[1] <= 9999

    @pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP", "GIF"])
    def test_whitelisted_formats_are_resized_and_keep_their_format(self, fmt):
        color = 1 if fmt == "GIF" else "green"
        mode = "P" if fmt == "GIF" else "RGB"
        data = _encode(Image.new(mode, (200, 200), color), fmt)
        result, changed = image_resize.resize_base64_image(data, 10000)
        assert changed is True
        with _decode(result) as resized:
            assert resized.format == fmt
            assert resized.size[0] * resized.size[1] <= 10000

    @pytest.mark.parametrize("fmt", ["BMP", "TIFF", "PPM"])
    def test_other_formats_are_rejected_by_name(self, fmt):
        data = _encode(Image.new("RGB", (200, 200), "gray"), fmt)
        with pytest.raises(ValueError, match=fmt) as excinfo:
            image_resize.resize_base64_image(data, 10000)
        assert "Automatic resizing does not support image format" in str(
            excinfo.value,
        )

    def test_animated_image_over_budget_is_rejected(self):
        data = _animated_gif((200, 200))
        # Guard: without a genuinely animated fixture this test would silently
        # degrade into "a still GIF gets resized".
        with _decode(data) as probe:
            assert getattr(probe, "is_animated", False) is True
        with pytest.raises(
            ValueError,
            match="does not support animated images",
        ):
            image_resize.resize_base64_image(data, 10000)

    def test_animated_webp_is_rejected_too(self):
        frames = [Image.new("RGB", (200, 200), c) for c in ("red", "green")]
        data = _encode(
            frames[0],
            "WEBP",
            save_all=True,
            append_images=frames[1:],
            loop=0,
        )
        with _decode(data) as probe:
            assert getattr(probe, "is_animated", False) is True
        with pytest.raises(ValueError, match="animated images"):
            image_resize.resize_base64_image(data, 10000)

    def test_animated_image_within_budget_hits_the_early_return(self):
        frames = [Image.new("RGB", (5, 5), c) for c in ("red", "green")]
        data = _encode(
            frames[0],
            "GIF",
            save_all=True,
            append_images=frames[1:],
            loop=0,
        )
        result, changed = image_resize.resize_base64_image(data, 100000)
        assert changed is False
        assert result is data

    @pytest.mark.parametrize(
        ("data", "label"),
        [
            ("!!!!not base64!!!!", "Invalid base64-encoded string"),
            (
                base64.b64encode(b"not an image").decode("ascii"),
                "cannot identify image file",
            ),
            ("", "cannot identify image file"),
        ],
    )
    def test_undecodable_input_reports_a_configuration_error(
        self,
        data,
        label,
    ):
        with pytest.raises(ValueError, match=re.escape(ENV)) as excinfo:
            image_resize.resize_base64_image(data, 10)
        assert label in str(excinfo.value)

    def test_decompression_bomb_is_reported_as_a_configuration_error(
        self,
        monkeypatch,
    ):
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
        data = _solid_png((200, 200))
        with pytest.raises(ValueError, match=re.escape(ENV)) as excinfo:
            image_resize.resize_base64_image(data, 10)
        assert "exceeds limit" in str(excinfo.value)

    def test_jpeg_cmyk_source_is_converted_to_rgb(self):
        buffer = BytesIO()
        Image.new("CMYK", (200, 200)).save(buffer, format="JPEG")
        data = base64.b64encode(buffer.getvalue()).decode("ascii")
        result, changed = image_resize.resize_base64_image(data, 10000)
        assert changed is True
        with _decode(result) as resized:
            assert resized.mode == "RGB"
            assert resized.format == "JPEG"

    def test_jpeg_greyscale_source_keeps_its_mode(self):
        buffer = BytesIO()
        Image.new("L", (200, 200)).save(buffer, format="JPEG")
        data = base64.b64encode(buffer.getvalue()).decode("ascii")
        result, _ = image_resize.resize_base64_image(data, 10000)
        with _decode(result) as resized:
            assert resized.mode == "L"

    def test_png_alpha_and_palette_sources_keep_their_mode(self):
        rgba = _encode(Image.new("RGBA", (200, 200)), "PNG")
        result, _ = image_resize.resize_base64_image(rgba, 10000)
        with _decode(result) as resized:
            assert resized.mode == "RGBA"

        palette = _encode(Image.new("P", (200, 200), 3), "PNG")
        result, _ = image_resize.resize_base64_image(palette, 10000)
        with _decode(result) as resized:
            assert resized.mode == "P"
            assert resized.palette is not None

    def test_icc_profile_survives_the_resize(self):
        profile = b"\x00\x00\x02\x0cADBE\x02\x10\x00\x00mntrRGB"
        buffer = BytesIO()
        Image.new("RGB", (200, 200), "teal").save(
            buffer,
            format="PNG",
            icc_profile=profile,
        )
        data = base64.b64encode(buffer.getvalue()).decode("ascii")
        result, changed = image_resize.resize_base64_image(data, 10000)
        assert changed is True
        with _decode(result) as resized:
            assert resized.info.get("icc_profile") == profile

    def test_output_is_deterministic_ascii_and_idempotent(self):
        data = _solid_png((300, 300))
        first, _ = image_resize.resize_base64_image(data, 10000)
        second, _ = image_resize.resize_base64_image(data, 10000)
        assert first == second
        assert first.isascii()
        base64.b64decode(first, validate=True)

        third, changed = image_resize.resize_base64_image(first, 10000)
        assert changed is False
        assert third is first

    def test_the_caller_string_is_not_mutated(self):
        data = _solid_png((200, 200))
        snapshot = str(data)
        image_resize.resize_base64_image(data, 10000)
        assert data == snapshot


class TestProviderMaxPixels:
    """Provider error messages carry the limit we should configure."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("Image exceeds maximum allowed pixels: 1000000", 1000000),
            ("maximum allowed total pixels = 4,194,304", 4194304),
            ("MAXIMUM ALLOWED PIXELS:12345", 12345),
            ("max pixels: 2048", 2048),
            ("Max Pixels = 999", 999),
            ("maximum pixels 1_000_000 given", 1000000),
            ("maximum allowed pixels: 1,_,2", 12),
            ("maximum allowed pixels: 0", 0),
        ],
    )
    def test_both_message_shapes_are_parsed(self, text, expected):
        assert image_resize._provider_max_pixels(text) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "no numbers here",
            "image too large",
            "maximum allowed pixels: ",
            "pixels: 100",
        ],
    )
    def test_texts_without_a_limit_return_none(self, text):
        assert image_resize._provider_max_pixels(text) is None

    def test_matched_digits_always_parse_so_the_fallback_stays_unused(self):
        # The ``except ValueError: continue`` branch is dead while the regex
        # charset stays ``[0-9_,]``; widening it would break this guarantee.
        charset = "0123456789_,"
        pattern = re.compile(r"[0-9][0-9_,]*")
        unparsable = []
        for first in "0123456789":
            for second in charset:
                for third in charset:
                    candidate = first + second + third
                    match = pattern.search(candidate)
                    if match is None:
                        continue
                    cleaned = match.group(0).replace(",", "").replace("_", "")
                    try:
                        int(cleaned)
                    except ValueError:
                        unparsable.append(candidate)
        assert unparsable == []

    def test_first_matching_pattern_wins(self):
        text = "max pixels: 111 but maximum allowed pixels: 222"
        assert image_resize._provider_max_pixels(text) == 222


class TestImagePixelLimitHint:
    """The user-facing hint shown when a provider rejects an image."""

    def test_messages_missing_image_or_pixel_are_ignored(self):
        assert (
            image_resize.image_pixel_limit_hint(
                Exception("pixel limit exceeded"),
            )
            is None
        )
        assert (
            image_resize.image_pixel_limit_hint(
                Exception("image too large"),
            )
            is None
        )

    def test_image_pixel_message_without_a_marker_is_ignored(self):
        assert (
            image_resize.image_pixel_limit_hint(
                Exception("the image has many pixel values"),
            )
            is None
        )

    @pytest.mark.parametrize(
        "marker",
        ["exceeds", "maximum allowed", "max pixels", "too many pixels"],
    )
    def test_every_marker_triggers_the_generic_hint(self, monkeypatch, marker):
        monkeypatch.delenv(ENV, raising=False)
        hint = image_resize.image_pixel_limit_hint(
            Exception(f"image {marker} the pixel budget"),
        )
        assert hint is not None
        assert hint.startswith(f"Set {ENV} to the provider's documented")
        assert "request-time image resizing" in hint

    def test_provider_limit_produces_a_concrete_setting(self, monkeypatch):
        monkeypatch.setenv(ENV, "0")
        hint = image_resize.image_pixel_limit_hint(
            Exception("Image exceeds maximum allowed pixels: 1000000"),
        )
        assert hint == (
            f"Set {ENV}=1000000 and restart QwenPaw to resize oversized "
            f"images before model requests."
        )

    def test_configured_above_provider_limit_asks_to_lower_it(
        self,
        monkeypatch,
    ):
        monkeypatch.setenv(ENV, "99999999")
        hint = image_resize.image_pixel_limit_hint(
            Exception("Image exceeds maximum allowed pixels: 1000000"),
        )
        assert hint == (
            f"{ENV} is currently 99999999; lower it to 1000000 and restart "
            f"QwenPaw."
        )

    @pytest.mark.parametrize("configured", ["500", "1000000"])
    def test_configured_at_or_below_provider_limit_asks_to_reduce(
        self,
        monkeypatch,
        configured,
    ):
        monkeypatch.setenv(ENV, configured)
        hint = image_resize.image_pixel_limit_hint(
            Exception("Image exceeds maximum allowed pixels: 1000000"),
        )
        assert hint == (
            f"{ENV} is currently {configured}; reduce it further and restart "
            f"QwenPaw."
        )

    def test_broken_configuration_is_reported_instead_of_a_hint(
        self,
        monkeypatch,
    ):
        monkeypatch.setenv(ENV, "abc")
        hint = image_resize.image_pixel_limit_hint(
            Exception("Image exceeds maximum allowed pixels: 2048"),
        )
        assert hint == (
            f"{ENV} must be zero or a positive integer, got 'abc'."
        )

    def test_whitespace_is_normalised_before_matching(self, monkeypatch):
        monkeypatch.setenv(ENV, "0")
        hint = image_resize.image_pixel_limit_hint(
            Exception("Image\n  exceeds   maximum allowed\n pixels: 2048"),
        )
        assert hint is not None
        assert f"{ENV}=2048" in hint
        assert "\n" not in hint

    def test_matching_is_case_insensitive(self, monkeypatch):
        monkeypatch.setenv(ENV, "0")
        hint = image_resize.image_pixel_limit_hint(
            Exception("IMAGE EXCEEDS MAXIMUM ALLOWED PIXELS: 2048"),
        )
        assert hint is not None
        assert f"{ENV}=2048" in hint

    def test_any_exception_subclass_is_accepted(self, monkeypatch):
        monkeypatch.setenv(ENV, "0")

        class ProviderError(RuntimeError):
            """Stand-in for a provider specific exception type."""

        hint = image_resize.image_pixel_limit_hint(
            ProviderError("image exceeds maximum allowed pixels: 4096"),
        )
        assert hint is not None
        assert f"{ENV}=4096" in hint

    def test_the_six_outcomes_are_distinguishable(self, monkeypatch):
        # Guard: if two branches ever collapse onto the same text, the
        # assertions above would keep passing while saying nothing.
        text = "Image exceeds maximum allowed pixels: 1000000"
        outcomes = []

        monkeypatch.setenv(ENV, "0")
        outcomes.append(image_resize.image_pixel_limit_hint(Exception(text)))
        monkeypatch.setenv(ENV, "500")
        outcomes.append(image_resize.image_pixel_limit_hint(Exception(text)))
        monkeypatch.setenv(ENV, "99999999")
        outcomes.append(image_resize.image_pixel_limit_hint(Exception(text)))
        monkeypatch.setenv(ENV, "abc")
        outcomes.append(image_resize.image_pixel_limit_hint(Exception(text)))

        # The last two must be read with a usable configuration, otherwise the
        # generic-hint branch would fall into the configuration-error branch
        # and collide with the outcome above.
        monkeypatch.delenv(ENV, raising=False)
        outcomes.append(
            image_resize.image_pixel_limit_hint(
                Exception("the image has many pixel values"),
            ),
        )
        outcomes.append(
            image_resize.image_pixel_limit_hint(
                Exception("image exceeds the allowed pixel budget"),
            ),
        )

        assert len({str(outcome) for outcome in outcomes}) == len(outcomes)
